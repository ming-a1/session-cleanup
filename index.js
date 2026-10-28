/**
 * Host half of the session-cleanup bundle.
 *
 * Owns the one operation the browser cannot perform itself: permanently remove
 * a stored session's log directory. It is offered on two callers over the same
 * implementation — an authenticated same-origin HTTP route used by the panel,
 * and a `session_cleanup` agent tool.
 *
 * The deletion target is the shipped JSONL persistence backend's session
 * directory. The backend exposes no delete operation, so this plugin resolves
 * the directory from the backend's own root and validates it before removing
 * anything (see `lib/cleanup.js`).
 */
import { resolve as resolvePath } from 'node:path';

import { deleteSession, normalizeSessionIds, previewSession } from './lib/cleanup.js';

/** Services the deletion path and its browser route require. */
export const inject = ['sessionPersistence', 'sessions', 'agents', 'connection', 'webServer', 'workspaceRegistry'];

/** Same-origin endpoint owned by this bundle. */
const ROUTE = '/session-cleanup/delete';
/** Request body cap; a batch of ids is far smaller. */
const BODY_LIMIT = 256 * 1024;
/** Failure carrying the HTTP status the route should answer with. */
class RouteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve the session storage root from the live JSONL backend instance.
 *
 * The backend resolves its configured root at activation and exposes it on the
 * instance; there is no supported second source, so a miss fails the operation
 * instead of guessing a directory.
 *
 * @param ctx - plugin context.
 * @returns absolute session root.
 */
function resolveRoot(ctx) {
  const service = ctx.sessionPersistence;
  if (service === undefined || typeof service.root !== 'string' || service.root.length === 0) {
    throw new Error('the mounted session persistence service does not expose its storage root; this plugin expects the JSONL backend');
  }
  return resolvePath(service.root);
}

/**
 * Run one preview or deletion batch.
 *
 * Liveness is handled here rather than in the file core: an idle attached
 * session can lose its stored files (the Host keeps the in-memory log, so the
 * row is archived to hide it until the process restarts), while a running
 * session is refused because its log is still being written.
 *
 * @param ctx - plugin context.
 * @param action - 'preview' or 'delete'.
 * @param ids - validated session ids.
 * @returns the batch report.
 */
async function runCleanup(ctx, action, ids) {
  const root = resolveRoot(ctx);
  const items = [];
  for (const id of ids) {
    try {
      items.push(action === 'delete' ? await removeSession(ctx, root, id) : await inspectSession(ctx, root, id));
    } catch (error) {
      items.push({ id, status: 'failed', reason: messageOf(error) });
    }
  }
  return { root, action, items: items.map(plainJson) };
}

/**
 * Drop undefined members so a result is lossless JSON.
 *
 * @param value - result value.
 * @returns JSON-clean copy.
 */
function plainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Preview one session without touching its files.
 *
 * @param ctx - plugin context.
 * @param root - session root.
 * @param id - session id.
 * @returns one result item.
 */
async function inspectSession(ctx, root, id) {
  const agent = ctx.agents.get(id);
  if (agent !== undefined && agent.status === 'running') return { id, status: 'running' };
  const file = await previewSession(root, id);
  return { ...file, live: ctx.sessions.get(id) !== undefined };
}

/**
 * Delete one session, archiving an idle attached session so its in-memory row
 * stays hidden after the files are gone.
 *
 * @param ctx - plugin context.
 * @param root - session root.
 * @param id - session id.
 * @returns one result item.
 */
async function removeSession(ctx, root, id) {
  const agent = ctx.agents.get(id);
  const live = ctx.sessions.get(id) !== undefined;
  if (agent !== undefined && agent.status === 'running') return { id, status: 'running', live };
  let archived = false;
  if (live) {
    try {
      await ctx.workspaceRegistry.archiveSession(id);
      archived = true;
    } catch (error) {
      if (Array.isArray(error?.activity)) return { id, status: 'running', live };
      ctx.logger?.warn?.(`session-cleanup: could not archive '${id}' before deletion: ${messageOf(error)}`);
    }
  }
  const file = await deleteSession(root, id);
  if (file.status === 'deleted') {
    if (!live) await forgetRegistryState(ctx, id);
    return { ...file, live };
  }
  if (archived) {
    try {
      await ctx.workspaceRegistry.unarchiveSession(id);
    } catch (error) {
      ctx.logger?.warn?.(`session-cleanup: could not restore archive state for '${id}': ${messageOf(error)}`);
    }
  }
  return { ...file, live };
}

/**
 * Format one failure for a result item.
 *
 * @param error - thrown value.
 * @returns message text.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Drop a deleted session from the workspace registry's archive and pin sets.
 *
 * Failure is contained: the files are already gone, and a stale id in either
 * set is filtered from Workspace views and never resurfaces as a session.
 *
 * @param ctx - plugin context.
 * @param sessionId - removed session.
 */
async function forgetRegistryState(ctx, sessionId) {
  try {
    await ctx.workspaceRegistry.unarchiveSession(sessionId);
  } catch (error) {
    ctx.logger?.warn?.(`session-cleanup: could not clear archive state for '${sessionId}': ${messageOf(error)}`);
  }
  try {
    await ctx.workspaceRegistry.unpinSession(sessionId);
  } catch (error) {
    ctx.logger?.warn?.(`session-cleanup: could not clear pin state for '${sessionId}': ${messageOf(error)}`);
  }
}

/**
 * Read a bounded JSON request body.
 *
 * @param req - incoming request.
 * @returns body text.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflow = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (overflow) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) reject(new RouteError(413, 'request body is too large'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/**
 * Answer one browser call.
 *
 * @param ctx - plugin context.
 * @param req - incoming request.
 * @param res - response to complete.
 */
async function handleRoute(ctx, req, res) {
  try {
    const rejection = ctx.connection.requestRejection({ headers: req.headers });
    if (rejection !== undefined) {
      res.writeHead(rejection);
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain' });
      res.end('method not allowed');
      return;
    }
    const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      res.writeHead(415, { 'content-type': 'text/plain' });
      res.end('content-type must be application/json');
      return;
    }
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new RouteError(400, 'body is not JSON');
    }
    const action = payload?.action;
    if (action !== 'preview' && action !== 'delete') {
      throw new RouteError(400, 'action must be "preview" or "delete"');
    }
    const normalized = normalizeSessionIds(payload?.sessionIds);
    if (normalized.error !== undefined) throw new RouteError(400, normalized.error);
    const result = await runCleanup(ctx, action, normalized.ids);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof RouteError ? error.status : 500;
    try {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    } catch {
      // The socket is already gone; nothing left to report on.
    }
  }
}

/**
 * Agent-facing tool over the same operation.
 *
 * @param ctx - plugin context.
 * @returns the tool definition.
 */
function createTool(ctx) {
  return {
    name: 'session_cleanup',
    description:
      'Inspect or permanently delete stored sessions by id. "preview" reports what the Host would remove; "delete" removes the session log directory from disk and cannot be undone. Always preview first, and only delete sessions the user explicitly asked to delete permanently.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['preview', 'delete'],
          description: 'preview reports deletion readiness; delete removes the stored session logs.',
        },
        sessionIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 200,
          description: 'Session ids to inspect or delete.',
        },
      },
      required: ['action', 'sessionIds'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string' },
          action: { type: 'string' },
          items: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
          },
        },
        required: ['root', 'action', 'items'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const action = args?.action;
      if (action !== 'preview' && action !== 'delete') throw new Error('action must be "preview" or "delete"');
      const normalized = normalizeSessionIds(args?.sessionIds);
      if (normalized.error !== undefined) throw new Error(normalized.error);
      return runCleanup(ctx, action, normalized.ids);
    },
  };
}

/**
 * Mount the browser route and the agent tool.
 *
 * @param ctx - plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: (req, res) => {
          void handleRoute(ctx, req, res);
        },
      }),
    'session-cleanup: delete route',
  );

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(createTool(ctx));
  });
}
