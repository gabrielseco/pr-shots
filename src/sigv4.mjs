// AWS Signature Version 4 for a single request, enough for S3-compatible
// stores (S3, Cloudflare R2, MinIO, Backblaze B2). No dependencies.
import { createHash, createHmac } from 'node:crypto';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// RFC 3986: everything but unreserved characters, which is stricter than
// encodeURIComponent (it leaves !'()* alone).
const encode = (text) =>
  encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

export const encodePath = (path) => path.split('/').map(encode).join('/');

/**
 * Returns the headers to send: the ones given plus host, x-amz-date,
 * x-amz-content-sha256 and authorization. Every header given is signed.
 */
export function sign({
  method,
  url,
  headers = {},
  payloadHash,
  accessKeyId,
  secretAccessKey,
  region,
  service = 's3',
  now = new Date(),
}) {
  const { host, pathname, searchParams } = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);

  const all = {
    ...Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ])
    ),
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(all).toSorted();
  const query = [...searchParams.entries()]
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .toSorted()
    .join('&');

  const canonicalRequest = [
    method,
    // The URL is built with encodePath, so pathname is already canonical.
    pathname,
    query,
    ...names.map((name) => `${name}:${String(all[name]).trim()}`),
    '',
    names.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  const key = [date, region, service, 'aws4_request'].reduce(
    hmac,
    `AWS4${secretAccessKey}`
  );
  const signature = hmac(key, stringToSign).toString('hex');

  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}
