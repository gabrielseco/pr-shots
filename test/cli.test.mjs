import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { branchShots, gitContext, shotPath, slug } from '../src/context.mjs';
import { galleryHtml } from '../src/gallery.mjs';
import {
  markdown,
  upload,
  uploadGallery,
  withScreenshots,
} from '../src/publish.mjs';
import { githubStore } from '../src/stores/github.mjs';
import { r2Store } from '../src/stores/r2.mjs';
import { s3Store } from '../src/stores/s3.mjs';

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repo(branch = 'feat/category-admin') {
  const dir = join(mkdtempSync(join(tmpdir(), 'pr-shots-')), 'expense-tracker');
  execFileSync('mkdir', ['-p', dir]);
  git(dir, 'init', '-q', '-b', 'main');
  git(
    dir,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  );
  git(dir, 'checkout', '-q', '-b', branch);
  return dir;
}

const shotsDir = () => ({
  PR_SHOTS_DIR: mkdtempSync(join(tmpdir(), 'shots-')),
});

test('names a screenshot <project>/<branch>-<name>-<sha>.png', () => {
  const dir = repo();
  const env = shotsDir();
  const context = gitContext(dir);

  assert.equal(context.project, 'expense-tracker');
  assert.equal(
    shotPath(context, 'Paid with', { env }),
    join(
      env.PR_SHOTS_DIR,
      'expense-tracker',
      `feat-category-admin-Paid-with-${context.sha}.png`
    )
  );
});

test("a worktree files under the main checkout's project", () => {
  const dir = repo();
  const worktree = join(dir, '..', 'some-worktree');
  git(dir, 'worktree', 'add', '-q', '-b', 'fix/x', worktree);

  assert.deepEqual(
    {
      project: gitContext(worktree).project,
      branch: gitContext(worktree).branch,
    },
    { project: 'expense-tracker', branch: 'fix-x' }
  );
});

test('lists this branch only, the newest take of each name', () => {
  const dir = repo('feat/a');
  git(dir, 'branch', 'feat/a-b');
  const env = shotsDir();
  const context = gitContext(dir);
  const folder = join(env.PR_SHOTS_DIR, 'expense-tracker');
  const write = (file, age) => {
    shotPath(context, 'x', { env });
    writeFileSync(join(folder, file), file);
    const time = Date.now() / 1000 - age;
    utimesSync(join(folder, file), time, time);
  };

  write('feat-a-list-1111111.png', 300);
  write('feat-a-list-2222222.png', 100);
  write('feat-a-empty-state-1111111.png', 200);
  write('feat-a-b-list-1111111.png', 50);
  write('main-list-1111111.png', 50);
  write('feat-a-notes.txt', 50);

  assert.deepEqual(
    branchShots(context, { env }).map((shot) => [shot.name, shot.sha]),
    [
      ['list', '2222222'],
      ['empty-state', '1111111'],
    ]
  );
});

test('slug keeps a name to one token', () => {
  assert.equal(slug(' feat/Category admin! '), 'feat-Category-admin');
});

test('config: flags beat the environment, a bucket selects the s3 store', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cfg-'));
  writeFileSync(
    join(cwd, '.pr-shots.json'),
    JSON.stringify({ bucket: 'from-file', prefix: 'p' })
  );
  const env = {
    XDG_CONFIG_HOME: cwd,
    PR_SHOTS_BUCKET: 'from-env',
    AWS_ACCESS_KEY_ID: 'key',
  };

  assert.deepEqual(
    loadConfig({ env, cwd, flags: { bucket: 'from-flag', region: undefined } }),
    {
      bucket: 'from-flag',
      prefix: 'p',
      accessKeyId: 'key',
      secretAccessKey: undefined,
      store: 's3',
    }
  );
  assert.equal(
    loadConfig({ env: { XDG_CONFIG_HOME: cwd }, cwd: tmpdir() }).store,
    'github'
  );
});

test('s3 store: signed path-style PUT, public URL back', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      });
      response.end();
    });
  }).listen(0);
  const endpoint = `http://127.0.0.1:${server.address().port}`;

  try {
    const file = join(
      mkdtempSync(join(tmpdir(), 'up-')),
      'feat-a-list (1)-1111111.png'
    );
    writeFileSync(file, 'pixels');
    const store = s3Store({
      bucket: 'shots',
      endpoint: `${endpoint}/`,
      publicUrl: 'https://img.example.com/',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });

    const [uploaded] = await upload(store, [{ path: file, name: 'list' }], {
      project: 'expense-tracker',
      prefix: '/pr/',
    });
    const [request] = requests;

    assert.match(
      uploaded.url,
      /^https:\/\/img\.example\.com\/pr\/expense-tracker\/[0-9a-f]{16}\/feat-a-list%20%281%29-1111111\.png$/
    );
    assert.equal(request.method, 'PUT');
    assert.equal(
      request.url,
      `/shots/${uploaded.url.slice('https://img.example.com/'.length)}`
    );
    assert.equal(request.body, 'pixels');
    assert.equal(request.headers['content-type'], 'image/png');
    assert.match(
      request.headers.authorization,
      /^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    );
  } finally {
    server.close();
  }
});

test('s3 store: says what is missing, and reports a refused upload', async () => {
  assert.throws(
    () => s3Store({ bucket: 'shots' }),
    /needs endpoint, publicUrl, accessKeyId, secretAccessKey/
  );

  const store = s3Store(
    {
      bucket: 'b',
      endpoint: 'http://x',
      publicUrl: 'http://y',
      accessKeyId: 'k',
      secretAccessKey: 's',
    },
    {
      fetch: async () => new Response('SignatureDoesNotMatch', { status: 403 }),
    }
  );
  await assert.rejects(
    store.put('a.png', Buffer.from('x')),
    /upload of a.png failed: 403 SignatureDoesNotMatch/
  );
});

test('github store: creates the orphan branch once, skips files already there', async () => {
  const calls = [];
  const present = new Set();
  const gh = (args, input) => {
    const [, path] = args;
    const method = args.includes('--method')
      ? args[args.indexOf('--method') + 1]
      : 'GET';
    calls.push(`${method} ${path}`);
    if (method === 'GET') {
      if (!present.has(path))
        throw Object.assign(new Error('gh: Not Found (HTTP 404)'), {
          stderr: 'HTTP 404',
        });
      return '{}';
    }
    const body = JSON.parse(input);
    if (path.endsWith('/git/refs'))
      present.add('repos/o/r/git/ref/heads/screenshots');
    if (path.includes('/contents/')) {
      assert.match(body.message, /\[skip ci\]/);
      assert.equal(Buffer.from(body.content, 'base64').toString(), 'pixels');
      present.add(`${path}?ref=screenshots`);
    }
    return JSON.stringify({ sha: 'abc' });
  };

  const store = githubStore({ repo: 'o/r' }, { gh });
  const url = await store.put('proj/hash/a b.png', Buffer.from('pixels'));
  await store.put('proj/hash/a b.png', Buffer.from('pixels'));

  assert.equal(
    url,
    'https://github.com/o/r/blob/screenshots/proj/hash/a%20b.png?raw=true'
  );
  assert.deepEqual(calls, [
    'GET repos/o/r/git/ref/heads/screenshots',
    'POST repos/o/r/git/trees',
    'POST repos/o/r/git/commits',
    'POST repos/o/r/git/refs',
    'GET repos/o/r/contents/proj/hash/a%20b.png?ref=screenshots',
    'PUT repos/o/r/contents/proj/hash/a%20b.png',
    'GET repos/o/r/contents/proj/hash/a%20b.png?ref=screenshots',
  ]);
});

test('the PR body gets a screenshots section, replaced on the next run', () => {
  const first = withScreenshots('## Summary\n\nText.\n', [
    { name: 'paid-with', url: 'https://x/1.png' },
  ]);
  assert.equal(
    first,
    '## Summary\n\nText.\n\n<!-- pr-shots:start -->\n## Screenshots\n\n<table>\n<tr>\n<td align="center" valign="top"><a href="https://x/1.png"><img src="https://x/1.png" width="260" alt="Paid with"></a><br><sub>Paid with</sub></td>\n</tr>\n</table>\n<!-- pr-shots:end -->\n'
  );

  const second = withScreenshots(`${first}\nFooter`, [
    { name: 'list', url: 'https://x/2.png' },
  ]);
  assert.ok(!second.includes('1.png'));
  assert.ok(
    second.startsWith('## Summary\n\nText.\n\n<!-- pr-shots:start -->')
  );
  assert.ok(second.endsWith('<!-- pr-shots:end -->\n\nFooter'));
});

const SHOT = [{ name: 'a', url: 'https://x/a.png' }];
const sectionOf = (hashes) => (body) =>
  body.match(new RegExp(`^${hashes} Screenshots$`, 'gm'))?.length ?? 0;

test('a template placeholder section is taken over in place', () => {
  const body =
    '## Summary\n\nText.\n\n## Screenshots\n\nN/A\n\n## Related Resources\n\nLinks\n';
  const out = withScreenshots(body, SHOT, undefined, () => assert.fail());
  assert.equal(sectionOf('##')(out), 1);
  assert.ok(
    out.startsWith(
      '## Summary\n\nText.\n\n<!-- pr-shots:start -->\n## Screenshots'
    )
  );
  assert.ok(
    out.endsWith('<!-- pr-shots:end -->\n\n## Related Resources\n\nLinks\n')
  );
  assert.ok(!out.includes('N/A'));
});

test('a placeholder that is only a comment, or the last section, is replaced', () => {
  const comment = withScreenshots(
    '## Screenshots\n\n<!-- Add screenshots -->\n\n## Notes\n',
    SHOT
  );
  assert.ok(comment.startsWith('<!-- pr-shots:start -->\n## Screenshots'));
  assert.ok(comment.endsWith('<!-- pr-shots:end -->\n\n## Notes\n'));
  assert.ok(!comment.includes('Add screenshots'));

  const last = withScreenshots(
    '## Summary\n\nText.\n\n## Screenshots\n\nTBD',
    SHOT
  );
  assert.equal(sectionOf('##')(last), 1);
  assert.ok(last.endsWith('<!-- pr-shots:end -->\n'));
  assert.ok(!last.includes('TBD'));
});

test('a template placeholder keeps its heading level', () => {
  const body = '## Summary\n\n### Screenshots\n\n-\n\n## Notes\n';
  const out = withScreenshots(body, SHOT);
  assert.equal(sectionOf('###')(out), 1);
  assert.equal(sectionOf('##')(out), 0);
  assert.equal(out, withScreenshots(out, SHOT));
});

test('a section with content is kept, and the warning says so', () => {
  const body = '## Screenshots\n\n![a](https://x/mine.png)\n\n## Notes\n';
  const warnings = [];
  const out = withScreenshots(body, SHOT, undefined, (m) => warnings.push(m));
  assert.ok(out.startsWith(body.trimEnd()));
  assert.ok(out.includes('<!-- pr-shots:start -->'));
  assert.deepEqual(warnings, [
    'pr-shots: kept the existing "Screenshots" section and added its own at the end',
  ]);
});

test('with markers present, a template heading elsewhere is left alone', () => {
  const body =
    '## Screenshots\n\nN/A\n\n<!-- pr-shots:start -->\n## Screenshots\n\nold\n<!-- pr-shots:end -->\n';
  const out = withScreenshots(body, SHOT);
  assert.ok(out.startsWith('## Screenshots\n\nN/A\n\n<!-- pr-shots:start -->'));
  assert.ok(!out.includes('old'));
});

test('running twice gives the same body as once', () => {
  const body = '## Summary\n\n## Screenshots\n\nN/A\n\n## Notes\n';
  const once = withScreenshots(body, SHOT, 'https://x/gallery.html');
  assert.equal(withScreenshots(once, SHOT, 'https://x/gallery.html'), once);
});

test('with a gallery, each thumbnail opens the carousel on its image', () => {
  const shots = ['a', 'b', 'c', 'd'].map((name) => ({
    name,
    url: `https://x/${name}.png`,
  }));
  const section = markdown(shots, 'https://x/h/gallery.html');

  assert.ok(
    section.startsWith('[Open as a gallery](https://x/h/gallery.html)')
  );
  assert.ok(section.includes('(⌘-click or Ctrl-click for a new tab)'));
  assert.ok(!markdown(shots).includes('⌘'));
  assert.deepEqual(
    [...section.matchAll(/<a href="([^"]+)">/g)].map((match) => match[1]),
    [1, 2, 3, 4].map((n) => `https://x/h/gallery.html#${n}`)
  );
  // Three to a row.
  assert.equal(section.match(/<tr>/g).length, 2);
});

test('gallery: uploaded as a page where the store serves pages', async () => {
  const puts = [];
  const store = {
    pages: true,
    put: async (key, body) => {
      puts.push({ key, body: body.toString() });
      return `https://pub.example/${key}`;
    },
  };
  const shots = [
    { name: 'edit-mode', url: 'https://pub.example/1.png' },
    { name: 'a"<b>', url: 'https://pub.example/2.png?x=1&y=2' },
  ];

  const url = await uploadGallery(store, shots, {
    project: 'expense-tracker',
    prefix: '/pr/',
    title: 'Build <cards> #121',
  });

  assert.match(
    url,
    /^https:\/\/pub\.example\/pr\/expense-tracker\/[0-9a-f]{16}\/gallery\.html$/
  );
  const [{ body }] = puts;
  assert.equal(body, galleryHtml({ title: 'Build <cards> #121', shots }));
  assert.ok(body.includes('<title>Build &lt;cards&gt; #121</title>'));
  assert.ok(
    body.includes(
      '<a href="#2" title="A&quot;&lt;b&gt;" data-src="https://pub.example/2.png?x=1&amp;y=2">'
    )
  );
  assert.ok(!body.includes('<b>'));

  assert.equal(
    await uploadGallery({ put: store.put }, shots, { project: 'p' }),
    undefined
  );
  assert.equal(puts.length, 1);
});

test('cli: path prints where the screenshot goes', () => {
  const dir = repo();
  const env = { ...process.env, ...shotsDir() };
  const out = execFileSync(
    'node',
    [join(import.meta.dirname, '..', 'bin', 'pr-shots.mjs'), 'path', 'list'],
    { cwd: dir, env, encoding: 'utf8' }
  ).trim();
  assert.match(basename(out), /^feat-category-admin-list-[0-9a-f]{7,}\.png$/);
});

test('r2 store: pipes the file to wrangler and returns the public URL', async () => {
  const calls = [];
  const store = r2Store(
    { bucket: 'shots', publicUrl: 'https://pub.example/' },
    { wrangler: (args, input) => calls.push({ args, input: input.toString() }) }
  );

  assert.equal(
    await store.put('proj/hash/a b.png', Buffer.from('pixels')),
    'https://pub.example/proj/hash/a%20b.png'
  );
  assert.deepEqual(calls, [
    {
      args: [
        'r2',
        'object',
        'put',
        'shots/proj/hash/a b.png',
        '--pipe',
        '--remote',
        '--content-type',
        'image/png',
      ],
      input: 'pixels',
    },
  ]);

  assert.throws(() => r2Store({ bucket: 'shots' }), /needs publicUrl/);
  const failing = r2Store(
    { bucket: 'b', publicUrl: 'https://p' },
    {
      wrangler: () => {
        throw Object.assign(new Error('exit 1'), {
          stderr: 'bucket not found',
        });
      },
    }
  );
  await assert.rejects(
    failing.put('a.png', Buffer.from('x')),
    /upload of a.png failed: bucket not found/
  );
});
