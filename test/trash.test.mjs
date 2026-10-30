/**
 * Recycle-bin tests: move, list, restore, permanent purge, retention, and
 * expiry sweeping, all inside a throwaway session root.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { encodeSegment } from '../lib/cleanup.js';
import {
  DEFAULT_RETENTION_DAYS,
  listEntries,
  refreshExpiry,
  moveIntoTrash,
  purgeEntry,
  purgeExpired,
  readRetentionDays,
  restoreEntry,
  trashPath,
  writeRetentionDays,
} from '../lib/trash.js';

/** Build one root with a project and one session directory. */
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'session-cleanup-trash-'));
  const root = join(base, 'sessions');
  const project = '--tmp-project--';
  const id = 'session-trash-test';
  const sessionDir = join(root, project, encodeSegment(id));
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'session.v4.jsonl'), '{"type":"session"}\n');
  return { base, root, project, id, sessionDir };
}

test('trash lives beside the persistence root', async () => {
  const { base, root } = await fixture();
  try {
    assert.equal(trashPath(root), join(base, '.session-cleanup-trash'));
    assert.equal(await readRetentionDays(root), DEFAULT_RETENTION_DAYS);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('deletion moves the session into the bin and keeps metadata', async () => {
  const { base, root, project, id, sessionDir } = await fixture();
  try {
    const meta = await moveIntoTrash({ root, sessionDir, id, project, title: '问候', sizeBytes: 42, live: false });
    await assert.rejects(stat(sessionDir), { code: 'ENOENT' });
    assert.equal(meta.title, '问候');
    assert.equal(meta.expiresAt - meta.deletedAt, DEFAULT_RETENTION_DAYS * 86400000);
    const entries = await listEntries(root);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].entryId, encodeSegment(id));
    assert.equal(entries[0].title, '问候');
    assert.equal(entries[0].expiresInDays, DEFAULT_RETENTION_DAYS);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('restore moves the session back and clears the entry', async () => {
  const { base, root, project, id, sessionDir } = await fixture();
  try {
    await moveIntoTrash({ root, sessionDir, id, project, title: '', sizeBytes: 1, live: false });
    const meta = await restoreEntry(root, encodeSegment(id));
    assert.equal(meta.id, id);
    await stat(join(sessionDir, 'session.v4.jsonl'));
    assert.equal((await listEntries(root)).length, 0);
    await assert.rejects(stat(join(trashPath(root), encodeSegment(id))), { code: 'ENOENT' });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('restore refuses to overwrite an existing session', async () => {
  const { base, root, project, id, sessionDir } = await fixture();
  try {
    await moveIntoTrash({ root, sessionDir, id, project, title: '', sizeBytes: 1, live: false });
    await mkdir(sessionDir, { recursive: true });
    await assert.rejects(restoreEntry(root, encodeSegment(id)), /already exists/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('permanent purge removes the entry', async () => {
  const { base, root, project, id, sessionDir } = await fixture();
  try {
    await moveIntoTrash({ root, sessionDir, id, project, title: '', sizeBytes: 1, live: false });
    await purgeEntry(root, encodeSegment(id));
    assert.equal((await listEntries(root)).length, 0);
    await assert.rejects(stat(join(trashPath(root), encodeSegment(id))), { code: 'ENOENT' });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('expired entries are swept, fresh ones survive', async () => {
  const { base, root, project, id, sessionDir } = await fixture();
  try {
    await moveIntoTrash({ root, sessionDir, id, project, title: '', sizeBytes: 1, live: false });
    const entry = join(trashPath(root), encodeSegment(id));
    const meta = JSON.parse(await readFile(join(entry, 'meta.json'), 'utf8'));
    meta.expiresAt = Date.now() - 1000;
    await writeFile(join(entry, 'meta.json'), JSON.stringify(meta));
    assert.equal(await purgeExpired(root), 1);
    assert.equal((await listEntries(root)).length, 0);
    await assert.rejects(stat(entry), { code: 'ENOENT' });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('entry ids are validated before any filesystem work', async () => {
  const { base, root } = await fixture();
  try {
    for (const bad of ['..', '.', 'a/b', 'a\\b', '', 'x'.repeat(1025)]) {
      await assert.rejects(purgeEntry(root, bad), /invalid trash entry id/);
      await assert.rejects(restoreEntry(root, bad), /invalid trash entry id|not found/);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('metadata without a payload is dropped from the listing', async () => {
  const { base, root, project, id, sessionDir } = await fixture();
  try {
    await moveIntoTrash({ root, sessionDir, id, project, title: '', sizeBytes: 1, live: false });
    await rm(join(trashPath(root), encodeSegment(id), 'session'), { recursive: true, force: true });
    const entries = await listEntries(root);
    assert.equal(entries.length, 0);
    await assert.rejects(stat(join(trashPath(root), encodeSegment(id))), { code: 'ENOENT' });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('changing retention refreshes existing entries', async () => {
  const { base, root, project, id, sessionDir } = await fixture();
  try {
    await moveIntoTrash({ root, sessionDir, id, project, title: '', sizeBytes: 1, live: false });
    await refreshExpiry(root, 30);
    const entries = await listEntries(root);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].expiresInDays, 30);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('retention setting is validated and persisted', async () => {
  const { base, root } = await fixture();
  try {
    assert.equal(await writeRetentionDays(root, 14), 14);
    assert.equal(await readRetentionDays(root), 14);
    await assert.rejects(writeRetentionDays(root, 0), /between/);
    await assert.rejects(writeRetentionDays(root, 1.5), /between/);
    const stored = JSON.parse(await readFile(join(trashPath(root), 'settings.json'), 'utf8'));
    assert.equal(stored.retentionDays, 14);
    assert.ok(dirname(join(trashPath(root), 'settings.json')).endsWith('.session-cleanup-trash'));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
