import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { sha256 } from './sigv4.mjs';
import { githubStore } from './stores/github.mjs';
import { s3Store } from './stores/s3.mjs';

export function createStore(config, deps) {
  if (config.store === 's3') return s3Store(config, deps);
  if (config.store === 'github') return githubStore(config, deps);
  throw new Error(`unknown store "${config.store}" (use s3 or github)`);
}

/**
 * Uploads each file and returns `{ file, name, url }`. The content hash in
 * the key makes the URL unguessable and lets a changed retake replace nothing.
 */
export async function upload(store, files, { project, prefix = '' }) {
  const uploaded = [];
  for (const file of files) {
    const body = readFileSync(file.path);
    const key = [prefix.replace(/^\/+|\/+$/g, ''), project, sha256(body).slice(0, 16), basename(file.path)]
      .filter(Boolean)
      .join('/');
    uploaded.push({ ...file, url: await store.put(key, body) });
  }
  return uploaded;
}

const START = '<!-- pr-shots:start -->';
const END = '<!-- pr-shots:end -->';

const title = (name) => name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function markdown(uploaded) {
  return uploaded.map(({ name, url }) => `**${title(name)}**\n\n![${title(name)}](${url})`).join('\n\n');
}

/** The body with its screenshots section replaced, or added at the end. */
export function withScreenshots(body, uploaded) {
  const section = `${START}\n## Screenshots\n\n${markdown(uploaded)}\n${END}`;
  const start = body.indexOf(START);
  const end = body.indexOf(END);

  if (start !== -1 && end > start) {
    return body.slice(0, start) + section + body.slice(end + END.length);
  }
  return `${body.trimEnd()}\n\n${section}\n`;
}
