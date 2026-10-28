/**
 * Direct tests for the file-level deletion core.
 *
 * Run with `node --test test/` from the package directory. Nothing here touches
 * a real Harness session store: the writable cases build their own temporary
 * root, and the read-only check grows out of the same fixtures.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { zstdCompressSync } from 'node:zlib';

import {
  decodeSegment,
  deleteSession,
  encodeSegment,
  inspectSessionDir,
  locateSessionDir,
  normalizeSessionIds,
  previewSession,
  runBatch,
} from '../lib/cleanup.js';

/** Build a JSONL backend session header for one id. */
function headerFor(id, cwd) {
  return {
    type: 'session',
    version: 4,
    id,
    createdAt: 1793000000000,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
  };
}

/** Compress a header-only session log, as the backend materializes it. */
function logFor(id, cwd) {
  return zstdCompressSync(Buffer.from(JSON.stringify(headerFor(id, cwd)) + '\n'));
}

/** Create one session directory exactly as the backend lays it out. */
async function makeSession(root, id, cwd, options = {}) {
  const project = options.project ?? '--' + cwd.replace(/[^A-Za-z0-9]/g, '-') + '--';
  const dir = join(root, project, encodeSegment(id));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, options.logName ?? 'session.v4.jsonl.zstd'), options.bytes ?? logFor(id, cwd));
  await writeFile(join(dir, 'session.lock'), '');
  return { dir, project: join(root, project) };
}

/** Fresh temp root for one test. */
async function makeRoot() {
  return mkdtemp(join(tmpdir(), 'session-cleanup-test-'));
}

test('encodeSegment round-trips ids and escapes path characters', () => {
  const ids = [
    'session-af4cb4ca-6cbb-41de-9a5b-5f775b7d7714',
    'plain',
    '.',
    '..',
    '~tilde',
    'with/slash',
    'with\\backslash',
    'null\u0000byte',
    'ünïcode',
    'lone\uD800surrogate',
  ];
  for (const id of ids) {
    const encoded = encodeSegment(id);
    assert.equal(decodeSegment(encoded), id, id);
    assert.ok(!encoded.includes('/'), id);
    assert.ok(!encoded.includes('\\'), id);
    assert.notEqual(encoded, '.');
    assert.notEqual(encoded, '..');
  }
  assert.throws(() => encodeSegment(''));
});

test('normalizeSessionIds dedupes, validates, and bounds batches', () => {
  assert.deepEqual(normalizeSessionIds(['a', 'b', 'a']), { ids: ['a', 'b'] });
  assert.ok(normalizeSessionIds([]).error);
  assert.ok(normalizeSessionIds('a').error);
  assert.ok(normalizeSessionIds([1]).error);
  assert.ok(normalizeSessionIds(['x'.repeat(1025)]).error);
  assert.ok(normalizeSessionIds(Array.from({ length: 201 }, (_, index) => 'id-' + index)).error);
});

test('preview and delete remove the backend session directory', async () => {
  const root = await makeRoot();
  try {
    const id = 'session-selftest-delete';
    const cwd = '/tmp/session-cleanup-fixture';
    const { dir, project } = await makeSession(root, id, cwd);

    const located = await locateSessionDir(root, id);
    assert.equal(located.status, 'found');
    assert.equal(located.dir, dir);

    const inspected = await inspectSessionDir(dir, id);
    assert.equal(inspected.status, 'deletable');
    assert.equal(inspected.verified, true);
    assert.ok(inspected.bytes > 0);

    const preview = await previewSession(root, id);
    assert.equal(preview.status, 'deletable');
    assert.equal(preview.verified, true);
    await stat(dir);

    const deleted = await deleteSession(root, id);
    assert.equal(deleted.status, 'deleted');
    await assert.rejects(stat(dir), { code: 'ENOENT' });
    assert.equal((await locateSessionDir(root, id)).status, 'missing');
    await stat(project);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a plain JSONL log is verified by its header', async () => {
  const root = await makeRoot();
  try {
    const id = 'session-selftest-plain';
    const { dir } = await makeSession(root, id, '/tmp/session-cleanup-plain', {
      logName: 'session.v4.jsonl',
      bytes: Buffer.from(JSON.stringify(headerFor(id, '/tmp/session-cleanup-plain')) + '\n'),
    });
    const inspected = await inspectSessionDir(dir, id);
    assert.equal(inspected.status, 'deletable');
    assert.equal(inspected.verified, true);
    assert.equal((await deleteSession(root, id)).status, 'deleted');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a header naming another session is refused', async () => {
  const root = await makeRoot();
  try {
    const id = 'session-selftest-mismatch';
    const { dir } = await makeSession(root, id, '/tmp/session-cleanup-mismatch', {
      logName: 'session.v4.jsonl',
      bytes: Buffer.from(JSON.stringify(headerFor('session-somebody-else', '/tmp/x')) + '\n'),
    });
    const inspected = await inspectSessionDir(dir, id);
    assert.equal(inspected.status, 'unsafe');
    assert.match(inspected.reason, /different session/);
    const deleted = await deleteSession(root, id);
    assert.equal(deleted.status, 'unsafe');
    await stat(dir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unexpected directory content is refused', async () => {
  const root = await makeRoot();
  try {
    const id = 'session-selftest-extra';
    const { dir } = await makeSession(root, id, '/tmp/session-cleanup-extra');
    await writeFile(join(dir, 'notes.txt'), 'not a session artifact');
    const inspected = await inspectSessionDir(dir, id);
    assert.equal(inspected.status, 'unsafe');
    assert.match(inspected.reason, /unexpected file/);
    assert.equal((await deleteSession(root, id)).status, 'unsafe');
    await stat(dir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unknown sessions are reported without touching the disk', async () => {
  const root = await makeRoot();
  try {
    assert.equal((await previewSession(root, 'session-does-not-exist')).status, 'missing');
    assert.equal((await deleteSession(root, 'session-does-not-exist')).status, 'missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('non-session directories under the root are ignored', async () => {
  const root = await makeRoot();
  try {
    const id = 'session-selftest-ignored';
    await mkdir(join(root, 'not-a-project', encodeSegment(id)), { recursive: true });
    assert.equal((await locateSessionDir(root, id)).status, 'missing');
    await stat(join(root, 'not-a-project', encodeSegment(id)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runBatch isolates per-session failures', async () => {
  const root = await makeRoot();
  try {
    const good = 'session-selftest-batch-good';
    const bad = 'session-selftest-batch-bad';
    await makeSession(root, good, '/tmp/session-cleanup-batch');
    const { dir: badDir } = await makeSession(root, bad, '/tmp/session-cleanup-batch');
    await writeFile(join(badDir, 'extra.bin'), 'x');
    const report = await runBatch({ root, ids: [good, bad, 'session-selftest-absent'], action: 'delete',  });
    const byStatus = Object.fromEntries(report.items.map((item) => [item.id, item.status]));
    assert.equal(byStatus[good], 'deleted');
    assert.equal(byStatus[bad], 'unsafe');
    assert.equal(byStatus['session-selftest-absent'], 'missing');
    await assert.rejects(stat(join(root, '--tmp-session-cleanup-batch--', encodeSegment(good))), { code: 'ENOENT' });
    await stat(badDir);
    const preview = await runBatch({ root, ids: [bad], action: 'preview',  });
    assert.equal(preview.items[0].status, 'unsafe');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the package reads its own manifest and icon', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.files.includes('lib/*.js'));
  assert.ok(manifest.files.includes('client.js'));
  assert.equal(manifest.exports['./client'], './client.js');
  const icon = await readFile(new URL('../icon.svg', import.meta.url), 'utf8');
  assert.match(icon, /^<svg/);
});
