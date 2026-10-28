/**
 * File-level session deletion for the session-cleanup bundle.
 *
 * DSH exposes no supported "delete a stored session" operation: the Session
 * persistence interface can create, open, stat, list, and flush, but not
 * remove. This module therefore works on the shipped JSONL backend's owned
 * session directory, and it fails closed:
 *
 * - the directory name must be the backend's exact path encoding of the id and
 *   must decode back to that id;
 * - the directory must sit directly below a project directory of the session
 *   root, and contain nothing but the session's own log generations and its
 *   lock file;
 * - the log header, when it can be read, must name the same session.
 *
 * Anything unexpected is reported as `unsafe` instead of deleted. The module
 * has no Cordis dependency so the same code can be exercised directly.
 *
 * @module session-cleanup/cleanup
 */
import { open, readdir, rm, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

/** Upper bound on one batch, matching the Host endpoint's request contract. */
export const MAX_BATCH = 200;

/** One session log generation, with or without the zstd suffix. */
const LOG_ENTRY = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;
/** The backend's per-session write-ownership lock file. */
const LOCK_ENTRY = 'session.lock';
/** A backend project directory: `--<readable-cwd>--` or the no-cwd bucket. */
const PROJECT_DIR = /^--.*--$/;

/**
 * Encode an arbitrary string as one safe path segment.
 *
 * This is the shipped JSONL backend's exact encoding: safe code units stay
 * literal, `.` and `..` are escaped whole, and every other UTF-16 unit becomes
 * `~XXXX`. A session directory is named with this encoding, so a mismatch
 * yields a non-existent path rather than a wrong deletion target.
 *
 * @param raw - non-empty session id.
 * @returns the injective single-segment spelling.
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character !== '~' && /^[A-Za-z0-9._-]$/.test(character)) out += character;
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/**
 * Decode one segment produced by {@link encodeSegment}.
 *
 * @param segment - encoded path segment.
 * @returns the original string, or undefined when the escapes are malformed.
 */
export function decodeSegment(segment) {
  let out = '';
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character !== '~') {
      out += character;
      continue;
    }
    const hex = segment.slice(index + 1, index + 5);
    if (!/^[0-9A-F]{4}$/.test(hex)) return undefined;
    out += String.fromCharCode(Number.parseInt(hex, 16));
    index += 4;
  }
  return out;
}

/**
 * Validate a client-supplied id batch.
 *
 * @param value - untrusted `sessionIds` value.
 * @returns `{ ids }` or `{ error }`.
 */
export function normalizeSessionIds(value) {
  if (!Array.isArray(value)) return { error: 'sessionIds must be an array of strings' };
  const ids = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 1024) {
      return { error: 'each session id must be a non-empty string of at most 1024 characters' };
    }
    if (!ids.includes(entry)) ids.push(entry);
  }
  if (ids.length === 0) return { error: 'sessionIds must not be empty' };
  if (ids.length > MAX_BATCH) return { error: `at most ${MAX_BATCH} session ids are accepted per request` };
  return { ids };
}

/**
 * Find the directory the session root owns for one session id.
 *
 * The project directory is not recomputed from its cwd: the id encoding is
 * unique across the root, so every project directory is probed for it. That
 * avoids duplicating the backend's cwd normalization while still requiring the
 * exact encoded id.
 *
 * @param root - absolute session root.
 * @param id - session id.
 * @returns `{status:'found', dir}` | `{status:'missing'}` | `{status:'unsafe', reason}`.
 */
export async function locateSessionDir(root, id) {
  const encoded = encodeSegment(id);
  if (decodeSegment(encoded) !== id) return { status: 'unsafe', reason: 'the session id has no reversible path encoding' };
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!PROJECT_DIR.test(entry.name) && entry.name !== '_no-cwd') continue;
    const candidate = join(root, entry.name, encoded);
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) matches.push(candidate);
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    }
  }
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'unsafe', reason: 'more than one directory matches this session id' };
  const dir = matches[0];
  if (!dir.startsWith(root + sep)) return { status: 'unsafe', reason: 'the resolved directory escapes the session root' };
  return { status: 'found', dir };
}

/**
 * Check that one session directory contains exactly session artifacts for id.
 *
 * @param dir - resolved session directory.
 * @param id - expected session id.
 * @returns `{status:'deletable', bytes, verified}` | `{status:'unsafe', reason}`.
 */
export async function inspectSessionDir(dir, id) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) return { status: 'unsafe', reason: `unexpected subdirectory "${entry.name}"` };
    if (entry.name !== LOCK_ENTRY && !LOG_ENTRY.test(entry.name)) {
      return { status: 'unsafe', reason: `unexpected file "${entry.name}"` };
    }
    files.push(entry.name);
  }
  const logs = files.filter((name) => name !== LOCK_ENTRY);
  if (logs.length === 0) return { status: 'unsafe', reason: 'the directory holds no session log' };
  let bytes = 0;
  for (const name of files) {
    try {
      bytes += (await stat(join(dir, name))).size;
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    }
  }
  const verified = await verifyHeader(dir, logs, id);
  if (verified === 'mismatch') return { status: 'unsafe', reason: 'the stored log header names a different session' };
  return { status: 'deletable', bytes, verified: verified === 'verified' };
}

/**
 * Report one session's deletion readiness.
 *
 * Liveness and running state belong to the Host policy; this function only
 * answers what the stored files look like.
 *
 * @param root - absolute session root.
 * @param id - session id.
 * @returns one result item.
 */
export async function previewSession(root, id) {
  const located = await locateSessionDir(root, id);
  if (located.status !== 'found') return { id, status: located.status, reason: located.reason };
  const inspected = await inspectSessionDir(located.dir, id);
  return {
    id,
    status: inspected.status,
    reason: inspected.reason,
    bytes: inspected.bytes,
    verified: inspected.verified,
    path: located.dir,
  };
}

/**
 * Permanently remove one session's stored directory.
 *
 * The caller is responsible for liveness policy; this function only removes
 * storage that passed validation.
 *
 * @param root - absolute session root.
 * @param id - session id.
 * @returns one result item; `deleted` on success.
 */
export async function deleteSession(root, id) {
  const located = await locateSessionDir(root, id);
  if (located.status !== 'found') return { id, status: located.status, reason: located.reason };
  const inspected = await inspectSessionDir(located.dir, id);
  if (inspected.status !== 'deletable') {
    return { id, status: inspected.status, reason: inspected.reason, path: located.dir };
  }
  await rm(located.dir, { recursive: true, force: true });
  return {
    id,
    status: 'deleted',
    bytes: inspected.bytes,
    verified: inspected.verified,
    path: located.dir,
  };
}

/**
 * Preview or delete a batch of stored sessions, isolating per-session failures.
 *
 * @param options - root, ids, and action.
 * @returns the batch report.
 */
export async function runBatch({ root, ids, action }) {
  const items = [];
  for (const id of ids) {
    try {
      items.push(action === 'delete' ? await deleteSession(root, id) : await previewSession(root, id));
    } catch (error) {
      items.push({ id, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { root, action, items };
}

/**
 * Read at most `maximum` leading bytes of a file without mapping the whole log.
 *
 * @param path - file to read.
 * @param maximum - byte cap.
 * @returns read bytes plus the file size.
 */
async function readHead(path, maximum) {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, maximum);
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await handle.read(buffer, filled, length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return { buffer: buffer.subarray(0, filled), size: info.size };
  } finally {
    await handle.close();
  }
}

/**
 * Verify that a session log's first record names `id`.
 *
 * Plain JSONL is read directly; compressed generations are decoded with the
 * process zstd decoder. A frame that cannot be decoded leaves the artifact
 * `unverified` (the directory and entry checks still apply), which is how a
 * corrupted log can still be deleted while a readable counter-example blocks
 * the removal.
 *
 * @param dir - session directory.
 * @param logs - the directory's log entries.
 * @param id - expected session id.
 * @returns 'verified' | 'mismatch' | 'unverified'.
 */
async function verifyHeader(dir, logs, id) {
  const plain = logs.filter((name) => name.endsWith('.jsonl')).sort().pop();
  if (plain !== undefined) {
    const head = await readHead(join(dir, plain), 512 * 1024);
    return headerMatch(firstLine(head.buffer.toString('utf8')), id);
  }
  const compressed = logs.filter((name) => name.endsWith('.zstd')).sort().pop();
  if (compressed === undefined) return 'unverified';
  for (const window of [64 * 1024, 1024 * 1024, 8 * 1024 * 1024]) {
    const head = await readHead(join(dir, compressed), window);
    if (head.buffer.length === 0) return 'unverified';
    try {
      return headerMatch(firstLine(zstdDecompressSync(head.buffer).toString('utf8')), id);
    } catch {
      if (head.size <= head.buffer.length) return 'unverified';
    }
  }
  return 'unverified';
}

/**
 * Compare one first log line with the expected session id.
 *
 * @param line - first line of the log, or undefined.
 * @param id - expected session id.
 * @returns 'verified' | 'mismatch' | 'unverified'.
 */
function headerMatch(line, id) {
  if (line === undefined || line.length === 0) return 'unverified';
  try {
    const value = JSON.parse(line);
    if (value === null || typeof value !== 'object' || value.type !== 'session') return 'unverified';
    return value.id === id ? 'verified' : 'mismatch';
  } catch {
    return 'unverified';
  }
}

/**
 * First newline-delimited line of a text block.
 *
 * @param text - decoded log prefix.
 * @returns the first line.
 */
function firstLine(text) {
  const index = text.indexOf('\n');
  return index === -1 ? text : text.slice(0, index);
}
