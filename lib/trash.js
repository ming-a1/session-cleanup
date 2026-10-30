/**
 * Recycle bin for the session-cleanup bundle.
 *
 * Deletion moves a session's storage directory out of the persistence root
 * instead of removing it, and JSON metadata beside it records where it came
 * from and when it expires. Retention is configurable (7 days by default) and
 * expired entries are purged permanently.
 *
 * The bin lives beside the persistence root, not inside it, so the JSONL
 * backend never lists trashed sessions. Both directories share a filesystem,
 * so moving is a rename; a cross-device fallback copies then removes.
 *
 * @module session-cleanup/trash
 */
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { encodeSegment } from './cleanup.js';

/** Bin directory name, created beside the persistence root. */
const TRASH_DIR = '.session-cleanup-trash';
/** Default retention in days. */
export const DEFAULT_RETENTION_DAYS = 7;
/** Accepted retention range. */
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;

/**
 * Absolute path of the recycle bin for one persistence root.
 *
 * @param root - session persistence root.
 * @returns bin directory path.
 */
export function trashPath(root) {
  return join(dirname(root), TRASH_DIR);
}

/**
 * Write one JSON document through a temporary sibling and rename, so a crash
 * cannot leave a half-written metadata file.
 *
 * @param path - destination file.
 * @param value - JSON-serializable value.
 */
async function writeJsonAtomic(path, value) {
  const temp = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, path);
}

/**
 * Whether a directory name is a safe single trash entry id.
 *
 * @param entryId - candidate name.
 * @returns true for one plain segment without separators or a leading dot.
 */
function validEntryId(entryId) {
  return typeof entryId === 'string' && entryId.length > 0 && entryId.length <= 1024 && /^[^./\\][^/\\]*$/.test(entryId);
}

/**
 * Read the retention setting, falling back to the default.
 *
 * @param root - session persistence root.
 * @returns retention in whole days.
 */
export async function readRetentionDays(root) {
  try {
    const value = JSON.parse(await readFile(join(trashPath(root), 'settings.json'), 'utf8'));
    const days = value?.retentionDays;
    if (Number.isSafeInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS) return days;
  } catch {
    // Absent or unreadable settings keep the default.
  }
  return DEFAULT_RETENTION_DAYS;
}

/**
 * Persist the retention setting.
 *
 * @param root - session persistence root.
 * @param retentionDays - whole days, within the accepted range.
 * @returns the stored value.
 */
export async function writeRetentionDays(root, retentionDays) {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < MIN_RETENTION_DAYS || retentionDays > MAX_RETENTION_DAYS) {
    throw new Error(`retentionDays must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`);
  }
  const trash = trashPath(root);
  await mkdir(trash, { recursive: true });
  await writeJsonAtomic(join(trash, 'settings.json'), { version: 1, retentionDays });
  return retentionDays;
}

/**
 * Move one session directory into the bin.
 *
 * @param options - root, current directory, identity, project directory name,
 *   display title, byte size, and whether the session is still live.
 * @returns the entry metadata.
 */
export async function moveIntoTrash({ root, sessionDir, id, project, title, sizeBytes, live }) {
  if (!/^(--.*--|_no-cwd)$/.test(project)) throw new Error('invalid project directory name');
  const trash = trashPath(root);
  const entryId = encodeSegment(id);
  const entryDir = join(trash, entryId);
  await mkdir(trash, { recursive: true });
  await rm(entryDir, { recursive: true, force: true });
  await mkdir(entryDir, { recursive: true });
  const now = Date.now();
  const retentionDays = await readRetentionDays(root);
  const meta = {
    version: 1,
    id,
    project,
    title: typeof title === 'string' ? title : '',
    bytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined,
    deletedAt: now,
    expiresAt: now + retentionDays * 86400000,
    live: live === true,
  };
  await writeJsonAtomic(join(entryDir, 'meta.json'), meta);
  const target = join(entryDir, 'session');
  try {
    try {
      await rename(sessionDir, target);
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'EXDEV') throw error;
      await cp(sessionDir, target, { recursive: true, errorOnExist: true, force: false });
      await rm(sessionDir, { recursive: true, force: true });
    }
  } catch (error) {
    // A half-written entry must not masquerade as a restorable session.
    await rm(entryDir, { recursive: true, force: true });
    throw error;
  }
  return meta;
}

/**
 * Read one entry's metadata.
 *
 * @param root - session persistence root.
 * @param entryId - encoded entry directory name.
 * @returns metadata, or undefined when absent or malformed.
 */
export async function readEntry(root, entryId) {
  if (!validEntryId(entryId)) return undefined;
  try {
    const meta = JSON.parse(await readFile(join(trashPath(root), entryId, 'meta.json'), 'utf8'));
    if (meta === null || typeof meta !== 'object' || typeof meta.id !== 'string' || typeof meta.project !== 'string') return undefined;
    return meta;
  } catch {
    return undefined;
  }
}

/**
 * List live (unexpired) entries, newest first.
 *
 * @param root - session persistence root.
 * @param now - current epoch milliseconds.
 * @returns entry metadata with `entryId` and `expiresInDays`.
 */
export async function listEntries(root, now = Date.now()) {
  let dirents;
  try {
    dirents = await readdir(trashPath(root), { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return [];
    throw error;
  }
  const entries = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const meta = await readEntry(root, dirent.name);
    if (meta === undefined) continue;
    try {
      await stat(join(trashPath(root), dirent.name, 'session'));
    } catch {
      // Metadata without a payload (interrupted move): drop the stale entry.
      await purgeEntry(root, dirent.name);
      continue;
    }
    const remaining = meta.expiresAt - now;
    entries.push({ ...meta, entryId: dirent.name, expiresInDays: Math.max(0, Math.ceil(remaining / 86400000)) });
  }
  entries.sort((left, right) => right.deletedAt - left.deletedAt);
  return entries;
}

/**
 * Permanently remove one bin entry.
 *
 * @param root - session persistence root.
 * @param entryId - entry directory name.
 */
export async function purgeEntry(root, entryId) {
  if (!validEntryId(entryId)) throw new Error('invalid trash entry id');
  await rm(join(trashPath(root), entryId), { recursive: true, force: true });
}

/**
 * Remove every expired entry.
 *
 * @param root - session persistence root.
 * @param now - current epoch milliseconds.
 * @returns number of purged entries.
 */
export async function purgeExpired(root, now = Date.now()) {
  let dirents;
  try {
    dirents = await readdir(trashPath(root), { withFileTypes: true });
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return 0;
    throw error;
  }
  let purged = 0;
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const meta = await readEntry(root, dirent.name);
    if (meta === undefined) continue;
    if (!Number.isFinite(meta.expiresAt) || meta.expiresAt > now) continue;
    await purgeEntry(root, dirent.name);
    purged += 1;
  }
  return purged;
}

/**
 * Recompute every entry's expiry after the retention setting changed.
 *
 * @param root - session persistence root.
 * @param retentionDays - new retention in whole days.
 * @returns number of refreshed entries.
 */
export async function refreshExpiry(root, retentionDays) {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < MIN_RETENTION_DAYS || retentionDays > MAX_RETENTION_DAYS) {
    throw new Error(`retentionDays must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`);
  }
  const entries = await listEntries(root);
  for (const entry of entries) {
    const meta = await readEntry(root, entry.entryId);
    if (meta === undefined) continue;
    meta.expiresAt = meta.deletedAt + retentionDays * 86400000;
    await writeJsonAtomic(join(trashPath(root), entry.entryId, 'meta.json'), meta);
  }
  return entries.length;
}

/**
 * Move one entry back into the persistence root.
 *
 * @param root - session persistence root.
 * @param entryId - entry directory name.
 * @returns restored metadata.
 */
export async function restoreEntry(root, entryId) {
  if (!validEntryId(entryId)) throw new Error('invalid trash entry id');
  const meta = await readEntry(root, entryId);
  if (meta === undefined) throw new Error('trash entry not found');
  if (!/^(--.*--|_no-cwd)$/.test(meta.project)) throw new Error('trash entry has an invalid project directory');
  const sessionDir = join(root, meta.project, entryId);
  try {
    await stat(sessionDir);
    throw new Error('a session with this id already exists in the store');
  } catch (error) {
    if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
  }
  await mkdir(join(root, meta.project), { recursive: true });
  const source = join(trashPath(root), entryId, 'session');
  try {
    await rename(source, sessionDir);
  } catch (error) {
    if (error === null || typeof error !== 'object' || error.code !== 'EXDEV') throw error;
    try {
      await cp(source, sessionDir, { recursive: true, errorOnExist: true, force: false });
    } catch (copyError) {
      await rm(sessionDir, { recursive: true, force: true });
      throw copyError;
    }
  }
  try {
    await purgeEntry(root, entryId);
  } catch {
    // The sessions are restored; a stale entry is dropped by the next listing.
  }
  return meta;
}
