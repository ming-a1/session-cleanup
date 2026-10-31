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
import { basename, dirname, resolve as resolvePath } from 'node:path';

import {
  createArchive,
  importArchive,
  listStoredSessions,
  readSessionFiles,
} from './lib/backup.js';
import { deleteSession, locateSessionDir, normalizeSessionIds, previewSession } from './lib/cleanup.js';
import { buildTranscript } from './lib/transcript.js';
import {
  listEntries,
  moveIntoTrash,
  purgeEntry,
  purgeExpired,
  refreshExpiry,
  readRetentionDays,
  restoreEntry,
  writeRetentionDays,
} from './lib/trash.js';

/** Services the deletion path and its browser route require. */
export const inject = ['sessionPersistence', 'sessionQuery', 'sessions', 'agents', 'connection', 'webServer', 'workspaceRegistry'];

/** Same-origin endpoint owned by this bundle. */
const ROUTE = '/session-cleanup/delete';
/** Backup upload endpoint; a restore may carry many megabytes. */
const IMPORT_ROUTE = '/session-cleanup/import';
/** Cap for one base64 import body. */
const IMPORT_BODY_LIMIT = 128 * 1024 * 1024;
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
  const file = await previewSession(root, id);
  if (file.status !== 'deletable') return { ...file, live };
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
  try {
    const project = basename(dirname(file.path));
    const title = await sessionTitle(ctx, id);
    await moveIntoTrash({
      root,
      sessionDir: file.path,
      id,
      project,
      title,
      sizeBytes: file.bytes,
      live,
    });
  } catch (error) {
    if (archived) {
      try {
        await ctx.workspaceRegistry.unarchiveSession(id);
      } catch {
        // Best-effort visibility restore.
      }
    }
    throw error;
  }
  if (!live) await forgetRegistryState(ctx, id);
  return { ...file, status: 'deleted', trashed: true, live };
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
function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let overflow = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (overflow) return;
      size += chunk.length;
      if (size > limit) {
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
 * Read one session's latest title, when the Host can provide it.
 *
 * @param ctx - plugin context.
 * @param sessionId - session id.
 * @returns title text, or undefined.
 */
async function sessionTitle(ctx, sessionId) {
  try {
    const snapshot = await ctx.sessionQuery.readTitle(sessionId);
    if (snapshot !== undefined && typeof snapshot.title === 'string' && snapshot.title.length > 0) return snapshot.title;
  } catch {
    // Titles are optional enrichment.
  }
  return undefined;
}

/**
 * Read one session's user/assistant text as a bounded transcript.
 *
 * The log is the source of truth, so a live session and a cold one read the
 * same way. Only text blocks are surfaced; reasoning, tool calls, and tool
 * results stay out of this compact view.
 *
 * @param ctx - plugin context.
 * @param sessionId - session to read.
 * @returns transcript item.
 */
async function readTranscript(ctx, sessionId) {
  let log;
  try {
    log = await ctx.sessionQuery.readSession(sessionId);
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
      return { id: sessionId, status: 'missing' };
    }
    throw error;
  }
  const header = log.session;
  const title = await sessionTitle(ctx, sessionId);
  const transcript = buildTranscript(log.events);
  let sizeBytes;
  try {
    const snapshot = await ctx.sessionPersistence.stat(sessionId);
    if (snapshot !== undefined) sizeBytes = snapshot.sizeBytes;
  } catch {
    sizeBytes = undefined;
  }
  return {
    id: sessionId,
    status: 'ok',
    title,
    cwd: header.cwd,
    createdAt: header.createdAt,
    sizeBytes,
    turns: transcript.turns,
    stats: transcript.stats,
    total: transcript.total,
    truncated: transcript.truncated,
  };
}

/**
 * Answer with one JSON body.
 *
 * @param res - response.
 * @param status - HTTP status.
 * @param value - JSON-serializable value.
 */
function respondJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

/**
 * Validate one trash entry-id list.
 *
 * @param value - untrusted payload value.
 * @returns `{ ids }` or `{ error }`.
 */
function normalizeEntryIds(value) {
  if (!Array.isArray(value)) return { error: 'entryIds must be an array of strings' };
  const ids = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !/^[^./\\][^/\\]*$/.test(entry) || entry.length > 1024) {
      return { error: 'each entry id must be one plain directory name' };
    }
    if (!ids.includes(entry)) ids.push(entry);
  }
  if (ids.length === 0) return { error: 'entryIds must not be empty' };
  if (ids.length > 200) return { error: 'at most 200 entries per request' };
  return { ids };
}

/**
 * Gather stored sessions into an archive.
 *
 * @param ctx - plugin context.
 * @param root - session persistence root.
 * @param ids - exact ids, or undefined for every stored session.
 * @returns archive bytes and the included count.
 */
async function buildBackup(ctx, root, ids) {
  let targets;
  if (ids === undefined) {
    targets = await listStoredSessions(root);
  } else {
    targets = [];
    for (const id of ids) {
      const located = await locateSessionDir(root, id);
      if (located.status !== 'found') continue;
      targets.push({ id, project: basename(dirname(located.dir)), dir: located.dir });
    }
  }
  const sessions = [];
  for (const target of targets) {
    const files = await readSessionFiles(target.dir);
    if (Object.keys(files).length === 0) continue;
    let header;
    try {
      header = (await ctx.sessionPersistence.stat(target.id))?.header;
    } catch {
      header = undefined;
    }
    sessions.push({
      id: target.id,
      project: target.project,
      title: (await sessionTitle(ctx, target.id)) ?? '',
      cwd: header?.cwd,
      createdAt: header?.createdAt ?? Date.now(),
      files,
    });
  }
  if (sessions.length === 0) throw new RouteError(404, 'no stored sessions to export');
  return { archive: createArchive(sessions), count: sessions.length };
}

/**
 * Answer one backup download.
 *
 * @param ctx - plugin context.
 * @param req - incoming request.
 * @param res - response to complete.
 * @param payload - parsed request body.
 */
async function handleExport(ctx, res, payload) {
  const root = resolveRoot(ctx);
  let ids;
  if (payload?.sessionIds !== undefined) {
    const normalized = normalizeSessionIds(payload.sessionIds);
    if (normalized.error !== undefined) throw new RouteError(400, normalized.error);
    ids = normalized.ids;
  }
  const { archive, count } = await buildBackup(ctx, root, ids);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  res.writeHead(200, {
    'content-type': 'application/gzip',
    'content-disposition': `attachment; filename="dsh-sessions-${stamp}.tar.gz"`,
    'content-length': String(archive.length),
    'x-session-count': String(count),
  });
  res.end(archive);
}

/**
 * Answer one backup import upload.
 *
 * @param ctx - plugin context.
 * @param req - incoming request.
 * @param res - response to complete.
 */
async function handleImport(ctx, req, res) {
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
    const body = await readBody(req, IMPORT_BODY_LIMIT);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new RouteError(400, 'body is not JSON');
    }
    if (typeof payload?.data !== 'string' || payload.data.length === 0) throw new RouteError(400, 'data must be a base64 archive');
    const buffer = Buffer.from(payload.data, 'base64');
    const root = resolveRoot(ctx);
    const result = await importArchive({ root, buffer });
    const imported = result.items.filter((item) => item.status === 'imported').length;
    respondJson(res, 200, { action: 'backup-import', imported, items: result.items });
  } catch (error) {
    const status = error instanceof RouteError ? error.status : 500;
    try {
      respondJson(res, status, { error: error instanceof Error ? error.message : String(error) });
    } catch {
      // Socket already gone.
    }
  }
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
    if (action === 'transcript') {
      const sessionId = payload?.sessionId;
      if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 1024) {
        throw new RouteError(400, 'sessionId must be a non-empty string');
      }
      const item = await readTranscript(ctx, sessionId);
      respondJson(res, 200, { action: 'transcript', item });
      return;
    }
    if (action === 'orphans') {
      const ids = [];
      for (const session of ctx.sessions.list()) {
        let stored;
        try {
          stored = await ctx.sessionPersistence.stat(session.id);
        } catch {
          stored = undefined;
        }
        if (stored === undefined) ids.push(session.id);
      }
      respondJson(res, 200, { action, ids });
      return;
    }
    if (action === 'trash-list') {
      const root = resolveRoot(ctx);
      await purgeExpired(root);
      const items = await listEntries(root);
      const retentionDays = await readRetentionDays(root);
      respondJson(res, 200, { action, retentionDays, items });
      return;
    }
    if (action === 'trash-settings') {
      const root = resolveRoot(ctx);
      const stored = await writeRetentionDays(root, payload?.retentionDays);
      await purgeExpired(root);
      await refreshExpiry(root, stored);
      respondJson(res, 200, { action, retentionDays: stored });
      return;
    }
    if (action === 'trash-restore' || action === 'trash-purge') {
      const normalizedEntries = normalizeEntryIds(payload?.entryIds);
      if (normalizedEntries.error !== undefined) throw new RouteError(400, normalizedEntries.error);
      const root = resolveRoot(ctx);
      const items = [];
      for (const entryId of normalizedEntries.ids) {
        try {
          if (action === 'trash-purge') {
            await purgeEntry(root, entryId);
            items.push({ entryId, status: 'purged' });
          } else {
            const meta = await restoreEntry(root, entryId);
            try {
              await ctx.workspaceRegistry.unarchiveSession(meta.id);
            } catch {
              // Restoring visibility is best-effort.
            }
            items.push({ entryId, status: 'restored', id: meta.id });
          }
        } catch (error) {
          items.push({ entryId, status: 'failed', reason: messageOf(error) });
        }
      }
      respondJson(res, 200, { action, items });
      return;
    }
    if (action === 'backup-export') {
      await handleExport(ctx, res, payload);
      return;
    }
    if (action !== 'preview' && action !== 'delete') {
      throw new RouteError(400, 'action must be "preview", "delete", or "transcript"');
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
      'Inspect or remove stored sessions by id. "preview" reports what the Host would move; "delete" moves the session log directories into the recycle bin, where they stay restorable until the retention period expires. Always preview first, and only remove sessions the user explicitly asked to delete.',
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

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: IMPORT_ROUTE,
        handler: (req, res) => {
          void handleImport(ctx, req, res);
        },
      }),
    'session-cleanup: import route',
  );

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(createTool(ctx));
  });

  ctx.inject(['timer'], (timerCtx) => {
    timerCtx.effect(() => {
      const sweep = () => {
        try {
          const root = resolveRoot(ctx);
          void purgeExpired(root).catch((error) => ctx.logger?.warn?.(`session-cleanup: trash sweep failed: ${messageOf(error)}`));
        } catch (error) {
          ctx.logger?.warn?.(`session-cleanup: trash sweep skipped: ${messageOf(error)}`);
        }
      };
      sweep();
      return timerCtx.timer.interval(sweep, 3600000);
    }, 'session-cleanup: trash retention sweep');
  });
}
