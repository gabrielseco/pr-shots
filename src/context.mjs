// Where a screenshot lives and what it is called:
//
//   <root>/<project>/<branch>-<name>-<sha>.png
//
// project is the repository's directory name (the main checkout's, so every
// worktree of it lands in the same folder), branch has its slashes turned
// into dashes, sha is the short HEAD.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** A branch or screenshot name as one filename-safe token. */
export const slug = (text) =>
  text
    .trim()
    .replace(/[^A-Za-z0-9._]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function root(env = process.env) {
  return resolve(env.PR_SHOTS_DIR ?? join(homedir(), 'screenshots', 'claude'));
}

export function gitContext(cwd = process.cwd()) {
  let commonDir;
  try {
    commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  } catch {
    throw new Error('not inside a git repository');
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const branches = git(['branch', '--format=%(refname:short)'], cwd)
    .split('\n')
    .filter(Boolean);

  return {
    // <repo>/.git -> <repo>; a bare repository's own directory otherwise.
    project: basename(basename(commonDir) === '.git' ? dirname(commonDir) : commonDir),
    branch: slug(branch === 'HEAD' ? 'detached' : branch),
    sha: git(['rev-parse', '--short', 'HEAD'], cwd),
    otherBranches: branches.map(slug).filter((name) => name !== slug(branch)),
  };
}

export function shotPath(context, name, { ext = 'png', env = process.env } = {}) {
  const dir = join(root(env), context.project);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${context.branch}-${slug(name)}-${context.sha}.${slug(ext)}`);
}

/**
 * This branch's screenshots, newest first, one per name: a retake after a
 * later commit replaces the earlier one.
 */
export function branchShots(context, { env = process.env } = {}) {
  const dir = join(root(env), context.project);
  if (!existsSync(dir)) return [];

  const prefix = `${context.branch}-`;
  // feat-a's prefix also matches feat-a-b's files; leave those to feat-a-b.
  const longer = context.otherBranches
    .filter((other) => other.startsWith(prefix))
    .map((other) => `${other}-`);

  const shots = readdirSync(dir)
    .filter((file) => file.startsWith(prefix) && !longer.some((p) => file.startsWith(p)))
    .flatMap((file) => {
      const match = file.slice(prefix.length).match(/^(.+)-([0-9a-f]{7,40})\.([A-Za-z0-9]+)$/);
      if (!match) return [];
      const path = join(dir, file);
      return [{ path, file, name: match[1], sha: match[2], mtime: statSync(path).mtimeMs }];
    })
    .sort((a, b) => b.mtime - a.mtime);

  const seen = new Set();
  return shots.filter((shot) => !seen.has(shot.name) && seen.add(shot.name));
}
