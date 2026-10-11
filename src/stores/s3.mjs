// Any S3-compatible bucket: Cloudflare R2, AWS S3, MinIO, Backblaze B2.
import { encodePath, sha256, sign } from '../sigv4.mjs';

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  html: 'text/html; charset=utf-8',
};

export const contentType = (file) =>
  CONTENT_TYPES[file.split('.').pop().toLowerCase()] ??
  'application/octet-stream';

export function s3Store(config, { fetch = globalThis.fetch } = {}) {
  const missing = [
    'bucket',
    'endpoint',
    'publicUrl',
    'accessKeyId',
    'secretAccessKey',
  ].filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `the s3 store needs ${missing.join(', ')} (flags, PR_SHOTS_* variables or a config file; see the README)`
    );
  }

  const endpoint = config.endpoint.replace(/\/+$/, '');
  const publicUrl = config.publicUrl.replace(/\/+$/, '');

  return {
    name: `s3://${config.bucket}`,
    // A public bucket serves an HTML page as a page: the gallery can live here.
    pages: true,

    /** Uploads `body` at `key` and resolves to the URL a browser can load. */
    async put(key, body) {
      const path = encodePath(key);
      // Path-style: works on every S3-compatible store, R2 included.
      const url = `${endpoint}/${config.bucket}/${path}`;
      const headers = sign({
        method: 'PUT',
        url,
        headers: { 'content-type': contentType(key) },
        payloadHash: sha256(body),
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        // R2 ignores the region and asks for "auto".
        region: config.region ?? 'auto',
      });
      // fetch sets Host itself and refuses to have it set.
      delete headers.host;

      const response = await fetch(url, { method: 'PUT', headers, body });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(
          `upload of ${key} failed: ${response.status} ${detail}`
        );
      }
      return `${publicUrl}/${path}`;
    },
  };
}
