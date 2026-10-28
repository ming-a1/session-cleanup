#!/usr/bin/env node
/**
 * Build one DSH plugin-market index entry (format 1) for this package.
 *
 * Usage:
 *   node scripts/make-market-index.mjs --repo https://github.com/<owner>/<repo> \
 *     --commit <40-hex-sha> [--path <dir-in-repo>] [--icon <absolute-url>] \
 *     [--timestamp <unix-seconds>] [--out plugin-market.json]
 *
 * Prints the JSON document to stdout unless --out is given. The document keeps
 * exactly the members `@deepseek-ai/dsh-plugin-market-index` accepts: format 1,
 * a localized title, empty declaration groups, and one version pinned to the
 * commit.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

/** Read `--name value` / `--name=value` pairs. */
function options(list) {
  const out = {};
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq !== -1) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const next = list[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`missing value for ${token}`);
    out[token.slice(2)] = next;
    index += 1;
  }
  return out;
}

/** Refuse values the market validator would reject. */
function checkUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error(`${label} must be an https URL without credentials, query, or fragment`);
  }
  return value.replace(/\/+$/, '');
}

const args = options(argv);
if (args.repo === undefined) throw new Error('--repo is required');
if (args.commit === undefined || !/^[0-9a-f]{40}$/.test(args.commit)) {
  throw new Error('--commit must be a full lowercase 40-hex git commit SHA');
}
const repo = checkUrl(args.repo.replace(/\.git$/, '').replace(/\/+$/, ''));
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const zh = JSON.parse(await readFile(resolve(root, 'locale/zh.json'), 'utf8'));
const en = JSON.parse(await readFile(resolve(root, 'locale/en.json'), 'utf8'));
const icon =
  args.icon !== undefined
    ? checkUrl(args.icon, '--icon')
    : repo.startsWith('https://github.com/')
      ? `${repo.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/${args.commit}/icon.svg`
      : `${repo}/raw/${args.commit}/icon.svg`;
const directory = args.path === undefined ? undefined : args.path.replace(/^\/+|\/+$/g, '');
const publishTimestamp = args.timestamp === undefined ? Math.floor(Date.now() / 1000) : Number(args.timestamp);
if (!Number.isSafeInteger(publishTimestamp) || publishTimestamp <= 0) throw new Error('--timestamp must be positive Unix seconds');

const index = {
  format: 1,
  title: { en: 'Session cleanup market', zh: '会话清理插件源' },
  description: {
    en: 'A plugin index for the DeepSeek Harness session-cleanup bundle.',
    zh: '会话清理插件的索引源。',
  },
  metadata: { categories: {}, labels: {}, sortKeys: {} },
  plugins: [
    {
      name: packageJson.name,
      title: { en: en.meta.title, zh: zh.meta.title },
      description: { en: en.meta.description, zh: zh.meta.description },
      icon,
      author: args.author ?? undefined,
      homepage: repo,
      repository: directory === undefined ? { url: repo } : { url: repo, directory },
      metadata: {
        keywords: Array.isArray(packageJson.keywords) ? packageJson.keywords : ['session', 'cleanup', 'delete', 'workspace'],
      },
      versions: [
        {
          version: packageJson.version,
          publishTimestamp,
          source: directory === undefined ? { type: 'git', url: repo, commit: args.commit } : { type: 'git', url: repo, commit: args.commit, path: directory },
          engines: {},
        },
      ],
    },
  ],
};

const text = JSON.stringify(index, null, 2) + '\n';
if (args.out === undefined) {
  process.stdout.write(text);
} else {
  await writeFile(resolve(process.cwd(), args.out), text);
  process.stderr.write(`wrote ${args.out}\n`);
}
