# QWS setup and configuration

[Main README and disclaimer](README.md) · [Русская документация](INFO.ru.md)

## Docker deployment

```sh
cp .env.example .env
# Set WEB_PASSWORD, QOBUZ_USERNAME and QOBUZ_PASSWORD privately.
docker compose up -d --build
docker compose logs -f
```

The image installs Node.js, Python, FFmpeg, pinned OrpheusDL and the Qobuz module.
It runs as an unprivileged user. Sign in to the web UI with `WEB_PASSWORD`.
By default, the published port is bound to `127.0.0.1:3000`.
Use a TLS reverse proxy for remote access; `WEB_BIND` and `WEB_PORT` control the host binding.
Run a single application instance: the queue and Orpheus session storage are shared.

After changing `.env`, recreate the container: `docker compose up -d --force-recreate`.
After updating the code or dependencies:

```sh
git pull origin main
docker compose up -d --build
```

For a trusted organizational CA, the Dockerfile accepts a BuildKit secret:
`docker build --secret id=build_ca,src=/path/to/organization-ca.pem -t qws-dl .`.
The certificate is added to the trust store; TLS and package-signature verification stay enabled.

## Environment variables

Relative local paths are resolved from the project root. Compose overrides storage and runtime paths
with container paths. Nuxt dev reads `.env`; `npm start` loads it using Node.js.
When running `.output/server/index.mjs` directly, supply the environment yourself.

| Variable                           | Meaning                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `WEB_PASSWORD`                     | Required web-interface password; without it the application API is closed |
| `QOBUZ_USERNAME`, `QOBUZ_PASSWORD` | Your Qobuz email and original account password                            |
| `QOBUZ_AUTH_MODE`                  | `web` by default; `mobile` enables the legacy API integration             |
| `QOBUZ_APP_ID`, `QOBUZ_APP_SECRET` | Only required in `mobile` mode; ignored in `web` mode                     |
| `DOWNLOAD_QUALITY`                 | `hifi`, `lossless`, or `high`; defaults to `hifi`                         |
| `DOWNLOAD_RETENTION_HOURS`         | Default lifetime after a job finishes: integer hours, 1–24; default 24    |
| `ORPHEUS_DIR`, `PYTHON_BIN`        | Installed OrpheusDL checkout and its virtual-environment Python           |
| `DATA_DIR`, `DOWNLOAD_DIR`         | Queue history and downloaded files                                        |
| `JOB_TIMEOUT_SECONDS`              | Maximum runtime per download job; default 7200 seconds                    |
| `WEB_BIND`, `WEB_PORT`             | Compose host binding and port; defaults `127.0.0.1` and `3000`            |
| `NUXT_APP_BASE_URL`                | Application path prefix; defaults to `/`, e.g. `/dl/`                     |

Qobuz quality targets: `hifi` up to FLAC 192 kHz / 24-bit, `lossless` FLAC 44.1 kHz / 16-bit,
and `high` MP3 320 kbit/s. Actual availability depends on Qobuz, the release, and your account.

## Qobuz web authentication

```dotenv
QOBUZ_AUTH_MODE=web
QOBUZ_USERNAME=your-email@example.com
QOBUZ_PASSWORD='your-original-password'
```

Use the original Qobuz account password, not a precomputed hash or a Google/Apple password.
Single quotes preserve `$` and `#` in Docker Compose `.env` files.
The worker uses `qobuz-dl` to obtain web-client parameters, authenticate and validate streaming access;
OrpheusDL continues handling downloaded files, cover art and tags.
You do not need to find mobile application keys or delete existing volumes to migrate.
Old `QOBUZ_APP_ID` / `QOBUZ_APP_SECRET` values are ignored in web mode and may be removed.
The worker does not reuse a cached mobile token for web authentication.

Legacy mode remains available with `QOBUZ_AUTH_MODE=mobile` and your matching mobile app credentials.
The server needs HTTPS access to `play.qobuz.com` for discovery, `www.qobuz.com` for API calls,
and the media/cover destinations returned by Qobuz.
Web-player changes may require an integration update.
Errors distinguish rejected credentials (401), an ineligible subscription, networking and player parsing.
A “Configured” UI status checks required settings and installed files; it does not prove successful login.

## ZIP downloads and automatic expiry

Select **1–24 hours** when adding a download. `DOWNLOAD_RETENTION_HOURS` supplies the default.
The retention clock starts when the job finishes, including failed/cancelled jobs with partial files.
Each job uses a separate UUID directory. Its expiry time appears in the queue.
Use the **ZIP** link in the queue or the archive card in the library to download the whole job.
Individual file downloads remain available.

ZIP archives are built on demand, cached inside the job directory and use ZIP64 for large files.
Audio is not recompressed, and the original folder structure is preserved.
Archive creation ignores symlinks; an archive never includes itself.
The cached archive can temporarily double the job's disk usage.
Archives are available after the downloader has stopped, including partial files from failed jobs.

At expiry, the application removes the job's directory, including originals and its cached ZIP.
New download requests for expired files are rejected, and files disappear from the library.
History is retained with an expiry marker. If deletion fails, the UI reports a permissions error
and the server retries; expired files remain inaccessible through the API.
Cleanup runs in the server and on startup: when the server is stopped, overdue files are removed
on its next start. Keep the server running for scheduled deletion.
Existing job records receive a default 24-hour expiry based on their finish time.
Unrelated manually placed directories and configuration files are not deleted.

## Persistent storage and queue behavior

Compose stores history/session data in `app-data` (`/data`) and downloads in `downloads` (`/downloads`).
`docker compose down` retains volumes; **`docker compose down -v` deletes the collection and configuration**.
To export remaining files: `docker compose cp qws-dl:/downloads ./saved-downloads`.
Locally, defaults are `data`, `downloads`, and `.runtime`.
Do not publish `.env`, session data or private volumes. The worker writes Orpheus credentials
and tokens with restrictive permissions; the browser receives setting-presence metadata only.
Logs are size-limited and redact configured secrets and URLs.

One Python downloader processes jobs in order. Cancellation stops its process group;
already written files remain available until expiry.
After restart, interrupted jobs are marked failed and queued jobs resume.
The queue accepts up to 50 active jobs. Recent history keeps 200 records plus unexpired jobs
so file cleanup is not lost. The library displays up to 1000 individual files.
OrpheusDL controls tagging and track availability. Detected individual-track failures mark
the job failed even if upstream exits with code 0.
The UI accepts media links; catalog search is not included.

## nginx under `/dl/`

Set `NUXT_APP_BASE_URL=/dl/`. Insert [deploy/nginx-dl.conf](deploy/nginx-dl.conf)
inside your existing `server {}` block, run `nginx -t`, and reload nginx.
The snippet assumes nginx on the host and the app on `127.0.0.1:3000`.
For nginx in a shared Docker network, change the upstream to `http://qws-dl:3000`.
Keep `proxy_pass` without a trailing slash: the app must receive the `/dl/` prefix.
API routes, assets, file/archive links and session cookies all follow the prefix.
`/api/health` becomes `/dl/api/health`.

Supported prefixes include `/`, `/dl`, `/dl/`, and `/music/dl/`.
Use a site path, not a full URL with a domain.
After updating to a version with prefix support, changing only this setting needs a container
recreation, not a new build. Local dev/production processes must restart after environment changes.

## Local development and validation

Requirements: Node.js 22.12+ or 24, Python 3.10+ with `venv`, Git and FFmpeg on `PATH`.
Debian/Ubuntu prerequisites: `apt-get install python3 python3-venv git ffmpeg`.

```sh
npm ci
npm run setup:orpheus
cp .env.example .env
# Configure .env privately.
npm run dev
```

Production: `npm run build`, then `npm start`.
The installation script is repeatable and refuses to overwrite modified tracked upstream files.

```sh
npm test
npm run test:python
npm run typecheck
npm run build
npm run test:integration
docker compose config --quiet
```

Python tests use real client libraries against local HTTP-response fixtures; no account is required.
HTTP integration tests exercise the production server, authentication, queue, Python bridge,
files, ZIP contents, expiry/restart and the supported base paths.
These tests do not establish that a particular account can download from live Qobuz.
For live validation, add an authorized media link, inspect the job and download its result.
The public health route only checks HTTP-server readiness.

At the last dependency audit, `npm audit` reported 11 high findings in build-tool chains
(`braces`, `node-forge`) that `npm audit fix` did not resolve with available upstream versions.
These packages were absent from the built `.output` server. Deploy the production image;
do not expose the development server publicly.

## Dependencies and licenses

Direct upstream components are listed in [README.md](README.md#third-party-dependency-notices).
OrpheusDL and its Qobuz module are pinned to commits in `scripts/install-orpheus.sh`;
their source checkouts are installed in `.runtime` locally or `/opt/runtime` in the container.
`qobuz-dl` 0.9.9.10 is installed as a Python dependency with its GPL-3.0 license.
Its source is available from [its upstream repository](https://github.com/vitiko98/qobuz-dl).
The adapter in `scripts/qobuz_web.py` uses its API; no third-party source has been copied into this repository.

Nuxt and Vue use MIT licenses; Node.js, Python, FFmpeg and all other packages retain their
own licenses. FFmpeg's applicable terms depend on the distributed build.
See each upstream distribution for full license/copyright notices.
Pinned JavaScript dependencies are recorded in `package-lock.json`;
Python dependencies are recorded in `requirements-orpheus.lock`.
