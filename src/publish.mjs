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
    ? `[Open as a gallery](${galleryUrl}) (⌘-click or Ctrl-click for a new tab): click a screenshot, then use the arrow keys.\n\n${grid}`
    : grid;
}

const PLACEHOLDERS = new Set(['', 'n/a', 'na', '-', 'none', 'tbd']);

/**
 * Finds a `Screenshots` heading outside code fences and the lines it owns:
 * up to the next heading of the same or a higher level, or the end.
 * `placeholder` is true when nothing was written under it.
 */
function templateSections(lines) {
  const found = [];
  let fence = false;
  let open;
  const close = (end) => {
    if (!open) return;
    const content = lines
      .slice(open.start + 1, end)
      .join('\n')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim()
      .toLowerCase();
    found.push({ ...open, end, placeholder: PLACEHOLDERS.has(content) });
    open = undefined;
  };

  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const heading = /^(#{1,6})\s/.exec(line);
    if (!heading) return;
    if (open && heading[1].length <= open.level) close(index);
    if (!open && /^#{1,6}\s*Screenshots\s*$/i.test(line))
      open = { start: index, level: heading[1].length };
  });
  close(lines.length);
  return found;
}

/**
 * The body with its screenshots section replaced, or added at the end. A
 * `Screenshots` heading from the PR template that holds only a placeholder is
 * taken over, at its own heading level; one with content is left alone.
 */
export function withScreenshots(
  body,
  uploaded,
  galleryUrl,
  warn = (message) => console.error(message)
) {
  const gallery = (hashes) =>
    `${START}\n${hashes} Screenshots\n\n${markdown(uploaded, galleryUrl)}\n${END}`;
  const start = body.indexOf(START);
  const end = body.indexOf(END);

  if (start !== -1 && end > start) {
    const previous = /^(#{1,6})\s*Screenshots\s*$/im.exec(
      body.slice(start, end)
    );
    return (
      body.slice(0, start) +
      gallery(previous ? previous[1] : '##') +
      body.slice(end + END.length)
    );
  }

  const lines = body.split('\n');
  const sections = templateSections(lines);
  const template = sections.find((section) => section.placeholder);
  if (template) {
    const before = lines.slice(0, template.start).join('\n');
    const after = lines.slice(template.end).join('\n');
    return `${before ? `${before}\n` : ''}${gallery('#'.repeat(template.level))}\n${after.trim() ? `\n${after}` : ''}`;
  }
  if (sections.length > 0)
    warn(
      'pr-shots: kept the existing "Screenshots" section and added its own at the end'
    );
  return `${body.trimEnd()}\n\n${gallery('##')}\n`;
}
