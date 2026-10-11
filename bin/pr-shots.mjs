#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.mjs';
import { branchShots, gitContext, root, shotPath } from '../src/context.mjs';
import { createStore, markdown, upload, withScreenshots } from '../src/publish.mjs';

const HELP = `pr-shots: keep the screenshots that prove a change, and put them in the pull request.

  pr-shots path <name> [--ext png]   where a screenshot of <name> belongs:
                                     <dir>/<project>/<branch>-<name>-<sha>.png
  pr-shots list                      this branch's screenshots
  pr-shots open                      open the project's folder
  pr-shots upload [file...]          upload (default: this branch's), print Markdown
  pr-shots pr [number]               upload this branch's screenshots and put them
                                     in the pull request's description

Stores (--store):
  github   a "screenshots" branch of the repository; nothing public, needs gh.
           Options: --repo owner/name, --branch screenshots
  r2       a Cloudflare R2 bucket through wrangler's own login: no keys.
           Options: --bucket, --public-url, --prefix
  s3       any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO).
           Options: --bucket, --endpoint, --public-url, --region, --prefix
           Keys: PR_SHOTS_ACCESS_KEY_ID / PR_SHOTS_SECRET_ACCESS_KEY (or AWS_*)

Every option is also a PR_SHOTS_<NAME> variable or a key in .pr-shots.json /
~/.config/pr-shots/config.json. PR_SHOTS_DIR moves the folder
(default ~/screenshots/claude).`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    ext: { type: 'string' },
    store: { type: 'string' },
    bucket: { type: 'string' },
    endpoint: { type: 'string' },
    'public-url': { type: 'string' },
    region: { type: 'string' },
    prefix: { type: 'string' },
    repo: { type: 'string' },
    branch: { type: 'string' },
  },
});

const [command, ...args] = positionals;

function config() {
  const { help: _help, ext: _ext, 'public-url': publicUrl, ...rest } = flags;
  return loadConfig({ flags: { ...rest, publicUrl } });
}

const gh = (ghArgs, input) =>
  execFileSync('gh', ghArgs, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });

async function main() {
  if (flags.help || !command || command === 'help') {
    console.log(HELP);
    return;
  }

  const context = gitContext();

  switch (command) {
    case 'path': {
      if (!args[0]) throw new Error('path needs a name: pr-shots path <name>');
      console.log(shotPath(context, args[0], { ext: flags.ext }));
      return;
    }

    case 'list': {
      for (const shot of branchShots(context)) console.log(shot.path);
      return;
    }

    case 'open': {
      const dir = join(root(), context.project);
      mkdirSync(dir, { recursive: true });
      const opener = { darwin: 'open', win32: 'explorer' }[process.platform] ?? 'xdg-open';
      execFileSync(opener, [dir], { stdio: 'ignore' });
      return;
    }

    case 'upload': {
      const files =
        args.length > 0
          ? args.map((file) => {
              const path = resolve(file);
              if (!existsSync(path)) throw new Error(`${file} does not exist`);
              return { path, name: basename(path).replace(/\.[^.]+$/, '') };
            })
          : branchShots(context);
      if (files.length === 0) throw new Error(`no screenshots for ${context.branch} in ${join(root(), context.project)}`);

      const settings = config();
      const uploaded = await upload(createStore(settings), files, { project: context.project, prefix: settings.prefix });
      console.log(markdown(uploaded));
      return;
    }

    case 'pr': {
      const shots = branchShots(context);
      if (shots.length === 0) {
        console.error(`no screenshots for ${context.branch} in ${join(root(), context.project)}; nothing to do`);
        return;
      }

      const selector = args[0] ? [args[0]] : [];
      const pr = JSON.parse(gh(['pr', 'view', ...selector, '--json', 'number,url,body']));
      const settings = config();
      const store = createStore(settings);
      const uploaded = await upload(store, shots.reverse(), { project: context.project, prefix: settings.prefix });

      gh(['pr', 'edit', String(pr.number), '--body-file', '-'], withScreenshots(pr.body, uploaded));
      console.log(`${uploaded.length} screenshot(s) from ${store.name} in ${pr.url}`);
      return;
    }

    default:
      throw new Error(`unknown command "${command}"\n\n${HELP}`);
  }
}

main().catch((error) => {
  console.error(`pr-shots: ${error.message}`);
  process.exitCode = 1;
});
