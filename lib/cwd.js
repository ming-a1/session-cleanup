/**
 * Read the persisted working directory of one stored session.
 *
 * Only the first zstd frame (which carries the header) is decoded, matching the
 * backend's framing and avoiding a full-log read.
 *
 * @module session-cleanup/cwd
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { decodeFirstFrame } from './zstd.js';

/** Logical session log generation. */
const LOG_ENTRY = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/;

/**
 * Read the newest generation header's `cwd`.
 *
 * @param dir - session directory.
 * @returns the stored cwd, or undefined when no header can be read.
 */
export async function readSessionCwd(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const logs = entries
    .filter((entry) => entry.isFile() && LOG_ENTRY.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of logs.reverse()) {
    try {
      const data = await readFile(join(dir, name));
      const text = name.endsWith('.zstd') ? decodeFirstFrame(data).toString('utf8') : data.toString('utf8');
      const header = JSON.parse(text.split('\n')[0]);
      if (header !== null && typeof header === 'object' && header.type === 'session') {
        return typeof header.cwd === 'string' ? header.cwd : undefined;
      }
    } catch {
      // Try the next generation.
    }
  }
  return undefined;
}
