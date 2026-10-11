// Settings, most specific first: flags, PR_SHOTS_* environment variables,
// .pr-shots.json in the working directory, ~/.config/pr-shots/config.json.
// Keep the keys out of the project file: it is the one that gets committed.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEYS = {
  store: 'PR_SHOTS_STORE',
  bucket: 'PR_SHOTS_BUCKET',
  endpoint: 'PR_SHOTS_ENDPOINT',
  publicUrl: 'PR_SHOTS_PUBLIC_URL',
  region: 'PR_SHOTS_REGION',
  prefix: 'PR_SHOTS_PREFIX',
  accessKeyId: 'PR_SHOTS_ACCESS_KEY_ID',
  secretAccessKey: 'PR_SHOTS_SECRET_ACCESS_KEY',
  repo: 'PR_SHOTS_REPO',
  branch: 'PR_SHOTS_BRANCH',
};

function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

const defined = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== ''));

export function loadConfig({ flags = {}, env = process.env, cwd = process.cwd() } = {}) {
  const fromEnv = Object.fromEntries(
    Object.entries(KEYS).map(([key, variable]) => [key, env[variable]])
  );

  const config = {
    ...readJson(join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'pr-shots', 'config.json')),
    ...readJson(join(cwd, '.pr-shots.json')),
    ...defined(fromEnv),
    ...defined(flags),
  };

  // The usual AWS variables work too, so an existing setup needs nothing new.
  config.accessKeyId ??= env.AWS_ACCESS_KEY_ID;
  config.secretAccessKey ??= env.AWS_SECRET_ACCESS_KEY;
  // A bucket means the S3 store; with nothing configured, the repository itself.
  config.store ??= config.bucket ? 's3' : 'github';
  return config;
}
