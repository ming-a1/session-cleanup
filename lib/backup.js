/**
 * Portable session backups for the session-cleanup bundle.
 *
 * A backup is one gzipped ustar archive:
 *
 *   manifest.json
 *   sessions/<project>/<encoded-id>/<generation files>
 *
 * The manifest carries identity and display metadata; the payload is the
 * backend's own session directory, so an import into another DSH store is a
 * byte-for-byte restore. No dependencies: tar and gzip come from node:zlib and
 * a small writer/reader kept here.
 *
 * Import validates every path segment, refuses to overwrite an existing
 * session, and checks the stored log header against the manifest id.
 *
 * @module session-cleanup/backup
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { gunzipSync, gzipSync, zstdCompressSync, zstdDecompressSync } from 'node:zlib';

import { decodeSegment, encodeSegment } from './cleanup.js';

/** Archive format version. */
export const BACKUP_FORMAT = 1;
/** Largest accepted archive payload after decompression. */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
/** Logical session log generation (also accepts historical ones). */
const LOG_ENTRY = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;
/** A backend project directory name. */
const PROJECT_ENTRY = /^(--.*--|_no-cwd)$/;

/**
 * Read one NUL-padded tar field.
 *
 * @param buffer - block.
 * @param offset - field start.
 * @param length - field length.
 * @returns trimmed text.
 */
function readField(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return (end === -1 ? slice : slice.subarray(0, end)).toString('utf8');
}

/**
 * Format one tar numeric field.
 *
 * @param value - non-negative integer.
 * @param length - field width including its terminator.
 * @returns zero-padded octal plus NUL.
 */
function octal(value, length) {
  return value.toString(8).padStart(length - 1, '0') + '\0';
}

/**
 * Build one ustar header for a regular file.
 *
 * @param path - archive path.
 * @param size - byte length.
 * @param mtime - epoch milliseconds.
 * @returns 512-byte header block.
 */
function header(path, size, mtime) {
  const block = Buffer.alloc(512, 0);
  let base = path;
  let prefix = '';
  if (Buffer.byteLength(path) > 100) {
    for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
      const tail = path.slice(index + 1);
      const head = path.slice(0, index);
      if (Buffer.byteLength(tail) <= 100 && Buffer.byteLength(head) <= 155) {
        base = tail;
        prefix = head;
        break;
      }
    }
    if (Buffer.byteLength(base) > 100) throw new Error('archive path is too long');
  }
  block.write(base, 0, 100);
  block.write(octal(0o644, 8), 100);
  block.write(octal(0, 8), 108);
  block.write(octal(0, 8), 116);
  block.write(octal(size, 12), 124);
  block.write(octal(Math.floor(mtime / 1000), 12), 136);
  block.write('        ', 148);
  block.write('0', 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  if (prefix) block.write(prefix, 345, 155);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(sum, 7) + ' ', 148);
  return block;
}

/**
 * Serialize files into a tar buffer.
 *
 * @param files - `{ name, data, mtime }`, directories implied by paths.
 * @returns tar bytes.
 */
export function createTar(files) {
  const blocks = [];
  for (const file of files) {
    blocks.push(header(file.name, file.data.length, file.mtime ?? Date.now()));
    blocks.push(file.data);
    const padding = (512 - (file.data.length % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

/**
 * Parse a tar buffer written by {@link createTar} or any ustar producer.
 *
 * @param buffer - tar bytes.
 * @returns `{ name, data }` entries in archive order.
 */
export function readTar(buffer) {
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error('archive is too large');
  const files = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const block = buffer.subarray(offset, offset + 512);
    let empty = true;
    for (const byte of block) {
      if (byte !== 0) {
        empty = false;
        break;
      }
    }
    if (empty) break;
    const name = readField(block, 0, 100);
    const size = Number.parseInt(readField(block, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(block[156] || 48);
    const prefix = readField(block, 345, 155);
    const path = prefix.length > 0 ? prefix + '/' + name : name;
    offset += 512;
    if (type === '0' || type === '\0') {
      if (offset + size > buffer.length) throw new Error('archive entry is truncated');
      files.push({ name: path, data: buffer.subarray(offset, offset + size) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

/**
 * Compress one session set into a backup archive.
 *
 * @param sessions - `{ id, project, title, cwd, createdAt, files: {name: Buffer} }`.
 * @returns `.tar.gz` bytes.
 */
export function createArchive(sessions) {
  const manifest = {
    format: BACKUP_FORMAT,
    plugin: 'session-cleanup',
    exportedAt: Date.now(),
    sessions: [],
  };
  const files = [];
  for (const session of sessions) {
    const encoded = encodeSegment(session.id);
    const names = Object.keys(session.files);
    manifest.sessions.push({
      id: session.id,
      project: session.project,
      title: session.title,
      cwd: session.cwd,
      createdAt: session.createdAt,
      files: names,
      bytes: names.reduce((sum, name) => sum + session.files[name].length, 0),
    });
    for (const name of names) {
      files.push({ name: `sessions/${session.project}/${encoded}/${name}`, data: session.files[name], mtime: session.createdAt });
    }
  }
  files.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
  return gzipSync(createTar(files));
}

/**
 * Decode one backup archive.
 *
 * @param buffer - `.tar.gz` bytes.
 * @returns `{ manifest, sessions: [{ id, project, files: { name: Buffer } }] }`.
 */
export function readArchive(buffer) {
  const files = readTar(gunzipSync(buffer));
  const manifestEntry = files.find((file) => file.name === 'manifest.json');
  if (manifestEntry === undefined) throw new Error('backup has no manifest');
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch {
    throw new Error('backup manifest is not valid JSON');
  }
  if (manifest === null || typeof manifest !== 'object' || manifest.format !== BACKUP_FORMAT) {
    throw new Error(`unsupported backup format (expected ${BACKUP_FORMAT})`);
  }
  const sessions = new Map();
  for (const file of files) {
    if (file.name === 'manifest.json') continue;
    const parts = file.name.split('/');
    if (parts.length !== 4 || parts[0] !== 'sessions') throw new Error(`unexpected archive entry ${JSON.stringify(file.name)}`);
    const [, project, encoded, name] = parts;
    if (!PROJECT_ENTRY.test(project)) throw new Error(`invalid project directory ${JSON.stringify(project)}`);
    if (!LOG_ENTRY.test(name)) throw new Error(`invalid session file ${JSON.stringify(name)}`);
    const id = decodeSegment(encoded);
    if (id === undefined || id.length === 0) throw new Error(`invalid session id encoding ${JSON.stringify(encoded)}`);
    const key = project + '/' + encoded;
    let session = sessions.get(key);
    if (session === undefined) {
      session = { id, project, files: {} };
      sessions.set(key, session);
    } else if (session.id !== id) {
      throw new Error('archive mixes session identities');
    }
    session.files[name] = file.data;
  }
  return { manifest, sessions: [...sessions.values()] };
}

/**
 * Whether a path is an existing directory.
 *
 * @param path - absolute path.
 * @returns true when stat succeeds with a directory.
 */
async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Rewrite a missing header cwd to one that exists on this Host.
 *
 * The stored cwd is an absolute path from the exporting machine. A different
 * DSH usually lacks it, and the working-directory layer refuses such a
 * header. Every generation's first line is rewritten and recompressed when
 * its cwd does not resolve here.
 *
 * @param files - log file name to bytes.
 * @param targetCwd - absolute existing directory to substitute.
 * @returns whether any file changed.
 */
async function rewriteCwd(files, targetCwd) {
  let rewritten = false;
  for (const [name, data] of Object.entries(files)) {
    const compressed = name.endsWith('.zstd');
    let text;
    try {
      text = compressed ? zstdDecompressSync(data).toString('utf8') : data.toString('utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    let header;
    try {
      header = JSON.parse(lines[0]);
    } catch {
      continue;
    }
    if (header === null || typeof header !== 'object' || header.type !== 'session') continue;
    if (typeof header.cwd !== 'string' || await isDirectory(header.cwd)) continue;
    header.cwd = targetCwd;
    lines[0] = JSON.stringify(header);
    const rebuilt = Buffer.from(lines.join('\n'), 'utf8');
    files[name] = compressed ? zstdCompressSync(rebuilt) : rebuilt;
    rewritten = true;
  }
  return rewritten;
}

/**
 * Verify one session's stored log names the same id.
 *
 * @param files - file name to bytes.
 * @param id - expected id.
 * @returns true when a header was readable and matched.
 */
function verifiedHeader(files, id) {
  const names = Object.keys(files);
  const plain = names.filter((name) => name.endsWith('.jsonl')).sort().pop();
  const compressed = names.filter((name) => name.endsWith('.zstd')).sort().pop();
  let text;
  try {
    if (plain !== undefined) text = files[plain].toString('utf8');
    else if (compressed !== undefined) text = zstdDecompressSync(files[compressed]).toString('utf8');
    else return false;
  } catch {
    return false;
  }
  const line = text.split('\n')[0];
  try {
    const value = JSON.parse(line);
    return value !== null && typeof value === 'object' && value.type === 'session' && value.id === id;
  } catch {
    return false;
  }
}

/**
 * Import one decoded archive into a session store.
 *
 * @param options - store root and archive buffer.
 * @returns per-session result items.
 */
export async function importArchive({ root, buffer, targetCwd }) {
  const { sessions } = readArchive(buffer);
  if (targetCwd !== undefined) {
    if (typeof targetCwd !== 'string' || !isAbsolute(targetCwd) || !await isDirectory(targetCwd)) {
      throw new Error('targetCwd must be an existing absolute directory');
    }
  }
  const items = [];
  for (const session of sessions) {
    try {
      const encoded = encodeSegment(session.id);
      const target = join(root, session.project, encoded);
      let exists = false;
      try {
        await stat(target);
        exists = true;
      } catch (error) {
        if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
      }
      if (exists) {
        items.push({ id: session.id, status: 'conflict', reason: 'a session with this id already exists' });
        continue;
      }
      if (Object.keys(session.files).length === 0) {
        items.push({ id: session.id, status: 'invalid', reason: 'archive entry has no log files' });
        continue;
      }
      if (!verifiedHeader(session.files, session.id)) {
        items.push({ id: session.id, status: 'invalid', reason: 'stored log header does not match the session id' });
        continue;
      }
      const rewritten = targetCwd === undefined ? false : await rewriteCwd(session.files, targetCwd);
      await mkdir(target, { recursive: true });
      for (const [name, data] of Object.entries(session.files)) {
        await writeFile(join(target, name), data);
      }
      items.push({ id: session.id, status: 'imported', cwdRewritten: rewritten });
    } catch (error) {
      items.push({ id: session.id, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { items };
}

/**
 * List every stored session directory under a persistence root.
 *
 * @param root - session persistence root.
 * @returns `{ id, project, dir }` entries.
 */
export async function listStoredSessions(root) {
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return [];
    throw error;
  }
  const sessions = [];
  for (const project of projects) {
    if (!project.isDirectory() || !PROJECT_ENTRY.test(project.name)) continue;
    const projectDir = join(root, project.name);
    const entries = await readdir(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = decodeSegment(entry.name);
      if (id === undefined || id.length === 0) continue;
      sessions.push({ id, project: project.name, dir: join(projectDir, entry.name) });
    }
  }
  return sessions;
}

/**
 * Read the log files of one session directory.
 *
 * @param dir - session directory.
 * @returns `{ name: Buffer }`, lock file excluded.
 */
export async function readSessionFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = {};
  for (const entry of entries) {
    if (!entry.isFile() || !LOG_ENTRY.test(entry.name)) continue;
    files[entry.name] = await readFile(join(dir, entry.name));
  }
  return files;
}
