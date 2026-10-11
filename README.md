# pr-shots

Keep the screenshots that prove a change, and put them in the pull request.

It does two things:

1. **Names them.** Every screenshot goes to one predictable place:
   `~/screenshots/claude/<project>/<branch>-<name>-<sha>.png`. `<project>` is the repository's
   directory (the main checkout's, so worktrees share it), `<branch>` has its slashes turned into
   dashes, `<sha>` is the short HEAD.
2. **Publishes them.** `pr-shots pr` uploads the current branch's screenshots and writes a
   `## Screenshots` section into the pull request's description. Running it again replaces the
   section.

No dependencies; Node 22 or later. `pr-shots pr` and the `github` store use the `gh` CLI.

## Install

    npm install -g /path/to/pr-shots      # or: npm link, from this directory

## Use

    # Take the screenshot wherever your tool wants a path
    npx playwright screenshot http://localhost:3000/settings "$(pr-shots path settings)"

    pr-shots list        # this branch's screenshots
    pr-shots open        # open the project's folder
    pr-shots upload      # upload them, print Markdown
    pr-shots pr          # upload them and put them in this branch's pull request

When a name was captured at several commits, the newest file wins.

## Where the images go

### `github` (default): a branch of the same repository

Files are committed to an orphan `screenshots` branch through the GitHub API, with `[skip ci]`.
GitHub serves them only to people who can read the repository, so **use this for private
repositories**. Nothing to configure. The images do not show in notification emails, and they
stay until you delete them from that branch.

    pr-shots pr --store github [--repo owner/name] [--branch screenshots]

### `r2`: Cloudflare R2 through wrangler

Uploads with `npx wrangler`, signed in by `wrangler login`, so there are no access keys to create or
store. Needs only the bucket and its public URL. Public like any bucket: see the note under `s3`.

    npx wrangler login
    npx wrangler r2 bucket create pr-shots
    npx wrangler r2 bucket dev-url enable pr-shots          # prints the public URL
    npx wrangler r2 bucket lifecycle add pr-shots expire-90d --expire-days 90

    pr-shots pr --store r2 --bucket pr-shots --public-url https://pub-<id>.r2.dev

### `s3`: any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO)

The bucket has to be publicly readable: anyone with a link can open the image. Each key contains
a hash of the file, so links can't be guessed, but don't put private data there.

    pr-shots pr \
      --bucket pr-shots \
      --endpoint https://<account-id>.r2.cloudflarestorage.com \
      --public-url https://pub-<id>.r2.dev

with `PR_SHOTS_ACCESS_KEY_ID` and `PR_SHOTS_SECRET_ACCESS_KEY` set (`AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` work too). For R2: create the bucket, enable its public `r2.dev` URL or a
custom domain, create an API token with Object Read & Write on that bucket, and add a lifecycle
rule that deletes objects after 90 days, so nothing needs cleaning up by hand.

## Configuration

Most specific first: flags, `PR_SHOTS_*` environment variables, `.pr-shots.json` in the working
directory, `~/.config/pr-shots/config.json`.

| Flag | Variable | JSON key |
|---|---|---|
| `--store` | `PR_SHOTS_STORE` | `store` |
| `--bucket` | `PR_SHOTS_BUCKET` | `bucket` |
| `--endpoint` | `PR_SHOTS_ENDPOINT` | `endpoint` |
| `--public-url` | `PR_SHOTS_PUBLIC_URL` | `publicUrl` |
| `--region` | `PR_SHOTS_REGION` | `region` (default `auto`) |
| `--prefix` | `PR_SHOTS_PREFIX` | `prefix` |
| `--repo` | `PR_SHOTS_REPO` | `repo` |
| `--branch` | `PR_SHOTS_BRANCH` | `branch` |
| | `PR_SHOTS_ACCESS_KEY_ID`, `PR_SHOTS_SECRET_ACCESS_KEY` | `accessKeyId`, `secretAccessKey` |
| | `PR_SHOTS_DIR` | (the folder, default `~/screenshots/claude`) |

A project's `.pr-shots.json` is the file that gets committed: keep the keys in the environment or
in the file under `~/.config`.

## Development

    npm install          # oxlint and oxfmt, the only (dev) dependencies
    npm test
    npm run lint
    npm run format       # or format:check
