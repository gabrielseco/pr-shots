// Cloudflare R2 through `wrangler`, using its own login: no access keys to
// create or store. Needs `wrangler login` once (npx fetches wrangler itself).
import { execFileSync } from 'node:child_process';
import { encodePath } from '../sigv4.mjs';
import { contentType } from './s3.mjs';

function defaultWrangler(args, input) {
  return execFileSync('npx', ['-y', 'wrangler', ...args], {
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function r2Store(config, { wrangler = defaultWrangler } = {}) {
  const missing = ['bucket', 'publicUrl'].filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `the r2 store needs ${missing.join(', ')} (flags, PR_SHOTS_* variables or a config file; see the README)`
    );
  }
  const publicUrl = config.publicUrl.replace(/\/+$/, '');

  return {
    name: `r2://${config.bucket}`,
    pages: true,

    async put(key, body) {
      try {
        wrangler(
          [
            'r2',
            'object',
            'put',
            `${config.bucket}/${key}`,
            '--pipe',
            '--remote',
            '--content-type',
            contentType(key),
          ],
          body
        );
      } catch (error) {
        const detail =
          `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().slice(-300) ||
          error.message;
        throw new Error(`upload of ${key} failed: ${detail}`, { cause: error });
      }
      return `${publicUrl}/${encodePath(key)}`;
    },
  };
}
