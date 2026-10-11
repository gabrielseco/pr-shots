// A branch of the repository itself. Nothing to set up and nothing public:
// GitHub only serves the images to people who can read the repository, so
// this is the store for private repositories. Needs the `gh` CLI, signed in.
import { execFileSync } from 'node:child_process';
import { encodePath } from '../sigv4.mjs';

function defaultGh(args, input) {
  return execFileSync('gh', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

const notFound = (error) => /HTTP 404/.test(`${error.stderr ?? ''}${error.message}`);

export function githubStore(config, { gh = defaultGh } = {}) {
  const repo =
    config.repo ?? gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim();
  const branch = config.branch ?? 'screenshots';
  const api = (path, body) =>
    JSON.parse(
      body === undefined
        ? gh(['api', `repos/${repo}/${path}`])
        : gh(['api', `repos/${repo}/${path}`, '--method', body.method, '--input', '-'], JSON.stringify(body.json))
    );

  const exists = (path) => {
    try {
      api(path);
      return true;
    } catch (error) {
      if (notFound(error)) return false;
      throw error;
    }
  };

  let branchReady = false;
  // An orphan branch: the screenshots share no history with the code.
  function ensureBranch() {
    if (branchReady || exists(`git/ref/heads/${branch}`)) return (branchReady = true);

    const tree = api('git/trees', {
      method: 'POST',
      json: {
        tree: [
          {
            path: 'README.md',
            mode: '100644',
            type: 'blob',
            content: 'Screenshots attached to pull requests by pr-shots. Not part of the code.\n',
          },
        ],
      },
    });
    const commit = api('git/commits', {
      method: 'POST',
      json: { message: 'chore: screenshots branch [skip ci]', tree: tree.sha },
    });
    api('git/refs', { method: 'POST', json: { ref: `refs/heads/${branch}`, sha: commit.sha } });
    return (branchReady = true);
  }

  return {
    name: `github:${repo}@${branch}`,

    async put(key, body) {
      ensureBranch();
      const path = encodePath(key);
      // The key carries the content's hash, so a file already there is this file.
      if (!exists(`contents/${path}?ref=${encodeURIComponent(branch)}`)) {
        api(`contents/${path}`, {
          method: 'PUT',
          json: {
            // [skip ci]: a push to this branch must not start the workflows.
            message: `chore: add ${key.split('/').pop()} [skip ci]`,
            content: Buffer.from(body).toString('base64'),
            branch,
          },
        });
      }
      return `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/${path}?raw=true`;
    },
  };
}
