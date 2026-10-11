import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { escapeHtml, galleryHtml, label } from './gallery.mjs';
import { sha256 } from './sigv4.mjs';
import { githubStore } from './stores/github.mjs';
import { r2Store } from './stores/r2.mjs';
import { s3Store } from './stores/s3.mjs';

export function createStore(config, deps) {
  if (config.store === 's3') return s3Store(config, deps);
  if (config.store === 'r2') return r2Store(config, deps);
  if (config.store === 'github') return githubStore(config, deps);
  throw new Error(`unknown store "${config.store}" (use s3, r2 or github)`);
}

/**
 * Uploads each file and returns `{ file, name, url }`. The content hash in
 * the key makes the URL unguessable and lets a changed retake replace nothing.
 */
export async function upload(store, files, { project, prefix = '' }) {
  const uploaded = [];
  for (const file of files) {
    const body = readFileSync(file.path);
    const key = [
      prefix.replace(/^\/+|\/+$/g, ''),
      project,
      sha256(body).slice(0, 16),
      basename(file.path),
    ]
      .filter(Boolean)
      .join('/');
    uploaded.push({ ...file, url: await store.put(key, body) });
  }
  return uploaded;
}

/**
 * Uploads the carousel page for `uploaded` and returns its URL, or undefined
 * when the store can't serve a page (GitHub shows a branch's HTML as source).
 */
export async function uploadGallery(
  store,
  uploaded,
  { project, prefix = '', title }
) {
  if (!store.pages || uploaded.length === 0) return undefined;
  const body = Buffer.from(galleryHtml({ title, shots: uploaded }));
  const key = [
    prefix.replace(/^\/+|\/+$/g, ''),
    project,
    sha256(body).slice(0, 16),
    'gallery.html',
  ]
    .filter(Boolean)
    .join('/');
  return store.put(key, body);
}

const START = '<!-- pr-shots:start -->';
const END = '<!-- pr-shots:end -->';
const COLUMNS = 3;
const THUMBNAIL_WIDTH = 260;

/**
 * A grid of thumbnails. With a gallery each one opens the carousel on that
 * image; without, the image itself.
 */
export function markdown(uploaded, galleryUrl) {
  const cells = uploaded.map(({ name, url }, index) => {
    const caption = escapeHtml(label(name));
    const href = galleryUrl ? `${galleryUrl}#${index + 1}` : url;
    return `<td align="center" valign="top"><a href="${escapeHtml(href)}"><img src="${escapeHtml(url)}" width="${THUMBNAIL_WIDTH}" alt="${caption}"></a><br><sub>${caption}</sub></td>`;
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += COLUMNS)
    rows.push(`<tr>\n${cells.slice(i, i + COLUMNS).join('\n')}\n</tr>`);

  const grid = `<table>\n${rows.join('\n')}\n</table>`;
  return galleryUrl
    ? `[Open as a gallery](${galleryUrl}): click a screenshot, then use the arrow keys.\n\n${grid}`
    : grid;
}

/** The body with its screenshots section replaced, or added at the end. */
export function withScreenshots(body, uploaded, galleryUrl) {
  const section = `${START}\n## Screenshots\n\n${markdown(uploaded, galleryUrl)}\n${END}`;
  const start = body.indexOf(START);
  const end = body.indexOf(END);

  if (start !== -1 && end > start) {
    return body.slice(0, start) + section + body.slice(end + END.length);
  }
  return `${body.trimEnd()}\n\n${section}\n`;
}
