/**
 * Zstandard frame helpers.
 *
 * The JSONL backend may append several zstd frames to one session log, while
 * `zstdDecompressSync` decodes only the first frame and silently stops. Rewrite
 * paths therefore touch only the frame that carries the header and append the
 * remaining frames untouched, so no event can be dropped.
 *
 * @module session-cleanup/zstd
 */
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

/** Zstandard frame magic number. */
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Split a concatenated-frame buffer at the second frame.
 *
 * @param buffer - stored zstd bytes.
 * @returns the first frame and the remaining frames (empty when single-frame).
 */
export function splitFirstFrame(buffer) {
  const next = buffer.indexOf(MAGIC, 4);
  if (next === -1) return { first: buffer, rest: Buffer.alloc(0) };
  return { first: buffer.subarray(0, next), rest: buffer.subarray(next) };
}

/**
 * Decode only the first frame (which carries the session header).
 *
 * @param buffer - stored zstd bytes.
 * @returns decoded bytes of the first frame.
 */
export function decodeFirstFrame(buffer) {
  return zstdDecompressSync(splitFirstFrame(buffer).first);
}

/**
 * Rewrite the first line of the first frame and keep later frames verbatim.
 *
 * @param buffer - stored zstd bytes.
 * @param update - mutates the parsed header; returns whether it changed.
 * @returns changed flag, parsed header, and rebuilt bytes when changed.
 */
export function updateFirstFrame(buffer, update) {
  const { first, rest } = splitFirstFrame(buffer);
  const text = zstdDecompressSync(first).toString('utf8');
  const lines = text.split('\n');
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    throw new Error('first zstd frame does not start with a JSON header');
  }
  if (header === null || typeof header !== 'object') throw new Error('first zstd frame header is not an object');
  if (!update(header)) return { changed: false, header };
  lines[0] = JSON.stringify(header);
  const recompressed = zstdCompressSync(Buffer.from(lines.join('\n'), 'utf8'));
  return { changed: true, header, buffer: Buffer.concat([recompressed, rest]) };
}
