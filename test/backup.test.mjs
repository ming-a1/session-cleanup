/**
 * Backup archive tests: tar/gzip roundtrip, manifest handling, import
 * validation (conflict, path segments, header mismatch), and store scanning.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  createArchive,
  createTar,
  importArchive,
  listStoredSessions,
  readArchive,
  readSessionFiles,
  readTar,
} from '../lib/backup.js';
import { encodeSegment } from '../lib/cleanup.js';

/** One session header line. */
function headerLine(id, cwd) {
  return JSON.stringify({ type: 'session', version: 4, id, createdAt: 1793000000000, cwd, isSeeded: false, delegationDepth: 0 }) + '\n';
}

test('tar roundtrip preserves names, bytes, and long paths', () => {
  const files = [
    { name: 'manifest.json', data: Buffer.from('{}') },
    { name: 'sessions/--tmp--/session-a/session.v4.jsonl', data: Buffer.from('hello') },
    { name: 'x/' + 'y'.repeat(120) + '/' + 'z'.repeat(80) + '.bin', data: Buffer.alloc(1500, 7) },
  ];
  const parsed = readTar(createTar(files));
  assert.equal(parsed.length, 3);
  assert.equal(parsed[1].name, files[1].name);
  assert.equal(parsed[1].data.toString(), 'hello');
  assert.equal(parsed[2].data.length, 1500);
});

test('archive roundtrip keeps manifest metadata and payload', () => {
  const id = 'session-backup-one';
  const archive = createArchive([
    {
      id,
      project: '--tmp--',
      title: '问候',
      cwd: '/tmp/project',
      createdAt: 1793000000000,
      files: { 'session.v4.jsonl': Buffer.from(headerLine(id, '/tmp/project')) },
    },
  ]);
  const decoded = readArchive(archive);
  assert.equal(decoded.manifest.format, 1);
  assert.equal(decoded.manifest.sessions[0].title, '问候');
  assert.equal(decoded.sessions.length, 1);
  assert.equal(decoded.sessions[0].id, id);
  assert.ok(decoded.sessions[0].files['session.v4.jsonl'].toString().includes(id));
});

test('import writes the session and refuses an existing id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-cleanup-backup-'));
  try {
    const id = 'session-import-one';
    const project = '--tmp-backup--';
    const archive = createArchive([
      {
        id,
        project,
        title: '',
        cwd: '/tmp/backup',
        createdAt: 1793000000000,
        files: { 'session.v4.jsonl': Buffer.from(headerLine(id, '/tmp/backup')) },
      },
    ]);
    const first = await importArchive({ root, buffer: archive });
    assert.deepEqual(first.items.map((item) => item.status), ['imported']);
    const target = join(root, project, encodeSegment(id), 'session.v4.jsonl');
    assert.ok((await readFile(target, 'utf8')).includes(id));

    const second = await importArchive({ root, buffer: archive });
    assert.deepEqual(second.items.map((item) => item.status), ['conflict']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('import rewrites a missing cwd to the target default directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-cleanup-backup-'));
  try {
    const id = 'session-move-one';
    const missing = '/definitely/not/here/' + id;
    const archive = createArchive([
      {
        id,
        project: '--tmp-move--',
        title: '',
        cwd: missing,
        createdAt: 1,
        files: { 'session.v4.jsonl': Buffer.from(headerLine(id, missing)) },
      },
    ]);
    const result = await importArchive({ root, buffer: archive, targetCwd: root });
    assert.equal(result.items[0].status, 'imported');
    assert.equal(result.items[0].cwdRewritten, true);
    const text = await readFile(join(root, '--tmp-move--', encodeSegment(id), 'session.v4.jsonl'), 'utf8');
    const header = JSON.parse(text.split('\n')[0]);
    assert.equal(header.cwd, root);
    await assert.rejects(importArchive({ root, buffer: archive, targetCwd: 'relative/path' }), /existing absolute directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('import keeps later zstd frames when it rewrites a missing cwd', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-cleanup-backup-'));
  try {
    const id = 'session-move-zstd';
    const missing = '/definitely/not/here/' + id;
    const event = Buffer.from(JSON.stringify({ type: 'event', seq: 2 }) + '\n');
    const first = zstdCompressSync(Buffer.from(headerLine(id, missing)));
    const second = zstdCompressSync(event);
    const archive = createArchive([
      {
        id,
        project: '--tmp-move--',
        title: '',
        cwd: missing,
        createdAt: 1,
        files: { 'session.v4.jsonl.zstd': Buffer.concat([first, second]) },
      },
    ]);
    const result = await importArchive({ root, buffer: archive, targetCwd: root });
    assert.equal(result.items[0].status, 'imported');
    const stored = await readFile(join(root, '--tmp-move--', encodeSegment(id), 'session.v4.jsonl.zstd'));
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
    const next = stored.indexOf(magic, 4);
    assert.ok(next > 0);
    const head = JSON.parse(zstdDecompressSync(stored.subarray(0, next)).toString('utf8').split('\n')[0]);
    assert.equal(head.cwd, root);
    assert.deepEqual(zstdDecompressSync(stored.subarray(next)), event);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('import rejects a mismatched log header', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-cleanup-backup-'));
  try {
    const id = 'session-import-two';
    const archive = createArchive([
      {
        id,
        project: '--tmp--',
        title: '',
        cwd: '/tmp/x',
        createdAt: 1,
        files: { 'session.v4.jsonl': Buffer.from(headerLine('session-someone-else', '/tmp/x')) },
      },
    ]);
    const result = await importArchive({ root, buffer: archive });
    assert.equal(result.items[0].status, 'invalid');
    await assert.rejects(stat(join(root, '--tmp--', encodeSegment(id))), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('import rejects path traversal and unknown entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-cleanup-backup-'));
  try {
    const manifest = { format: 1, plugin: 'session-cleanup', sessions: [] };
    const traversal = gzipSync(
      createTar([
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
        { name: 'sessions/--x--/../../evil', data: Buffer.from('x') },
      ]),
    );
    await assert.rejects(importArchive({ root, buffer: traversal }), /unexpected archive entry/);
    const badName = gzipSync(
      createTar([
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
        { name: 'sessions/--x--/abc/evil.txt', data: Buffer.from('x') },
      ]),
    );
    await assert.rejects(importArchive({ root, buffer: badName }), /invalid session file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('listStoredSessions and readSessionFiles scan the store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-cleanup-backup-'));
  try {
    const id = 'session-scan-one';
    const dir = join(root, '--tmp-scan--', encodeSegment(id));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'session.v4.jsonl'), 'x');
    await writeFile(join(dir, 'session.lock'), '');
    const sessions = await listStoredSessions(root);
    assert.deepEqual(sessions.map((session) => session.id), [id]);
    const files = await readSessionFiles(dir);
    assert.deepEqual(Object.keys(files), ['session.v4.jsonl']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
