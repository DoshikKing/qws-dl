# QWS setup and configuration

[Main README and disclaimer](README.md) · [Русская документация](INFO.ru.md)

## Docker deployment

```sh
cp .env.example .env
# Set ADMIN_USERNAME and ADMIN_PASSWORD privately.
docker compose up -d --build
docker compose logs -f
```

The image installs Node.js, Python, FFmpeg, pinned OrpheusDL and the Qobuz module.
It runs as an unprivileged user. Choose **Sign in** and use `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
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

| Variable                            | Meaning                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`  | Administrator login (default `admin`) and password (10–256 characters); created/synced on startup  |
| `USER_INVITE_LIMIT`                 | Lifetime invite registrations per user, 0–10000; default 1; admin unlimited                        |
| `DOWNLOAD_QUALITY`                  | `hifi`, `lossless`, or `high`; defaults to `hifi`                                                  |
| `DOWNLOAD_RETENTION_HOURS`          | Default lifetime after a job finishes: integer hours, 1–24; default 24                             |
| `ORPHEUS_DIR`, `PYTHON_BIN`         | Installed OrpheusDL checkout and its virtual-environment Python                                    |
| `DATA_DIR`, `DOWNLOAD_DIR`          | Queue history and downloaded files                                                                 |
| `JOB_TIMEOUT_SECONDS`               | Maximum runtime per download job; default 7200 seconds                                             |
| `WEB_BIND`, `WEB_PORT`              | Compose host binding and port; defaults `127.0.0.1` and `3000`                                     |
| `NUXT_APP_BASE_URL`                 | Application path prefix; defaults to `/`, e.g. `/dl/`                                              |

Qobuz quality targets: `hifi` up to FLAC 192 kHz / 24-bit, `lossless` FLAC 44.1 kHz / 16-bit,
and `high` MP3 320 kbit/s. Actual availability depends on Qobuz, the release, and your account.

## Accounts and invitations

Set `ADMIN_USERNAME=admin`, a private `ADMIN_PASSWORD` of 10–256 characters, and
`USER_INVITE_LIMIT=1` in `.env`, then restart/recreate the application.
The administrator account is created on startup. Updating its environment credentials
updates the same account and revokes its sessions; its invitation code remains unchanged.
Usernames contain 3–32 ASCII letters/digits, dots, underscores or hyphens and are case-insensitive.
There is no public registration without a valid invitation.

The initial screen accepts an invitation code; existing users, including the administrator,
choose **Войти**. After validation, the invited person chooses a login and password.
Settings show each user's invite code and remaining quota. Codes are reusable up to the
lifetime quota: deleting an invited account does not restore it. `USER_INVITE_LIMIT` accepts
0–10000, defaults to 1 and is read on restart. The administrator's code has no quota.
Blocking or deleting an inviter also disables their code; existing invitees keep their accounts.

The **Пользователи** administrator view lists accounts, inviter and usage, and supports
blocking/unblocking, password reset, and confirmed account deletion. The bootstrap
administrator cannot be deleted or blocked from the UI; manage its credentials via `.env`.
Users change their own passwords in Settings. Password changes, resets, blocking, deletion,
and logout revoke the relevant sessions. Blocking/deletion also cancels that user's active jobs;
remaining files expire on the existing schedule. Accounts cannot be promoted through registration.

Each user sees and downloads only their own jobs and ZIPs, with ownership enforced in the API.
The administrator's regular downloads view includes their own and legacy jobs. The separate
**Хранилище** view lists every user's archives and allows confirmed deletion, without granting
cross-account download access. Deletion removes the job directory immediately, blocks subsequent
download requests, and keeps history with a deletion marker. Active downloads/archiving cannot
be deleted; cancel a download first and wait for packaging to finish. Qobuz credentials remain shared server configuration; app accounts
are not Qobuz accounts or subscriptions.

Accounts and salted scrypt password hashes are stored in `DATA_DIR/users.json` (mode 0600).
Opaque 12-hour session tokens use HttpOnly/SameSite=Strict cookies scoped to the app base path;
only token hashes are persisted. Use TLS for Secure cookies. Keep this file/volume private and
back it up with the rest of `DATA_DIR`. Run one Node process/replica: JSON persistence and the
Orpheus worker are single-process. A global authentication/management attempt limit protects hashing
without trusting forwarded IP headers.

For migration only, an existing `WEB_PASSWORD` supplies the administrator password if
`ADMIN_PASSWORD` is absent, with login `admin` unless `ADMIN_USERNAME` is set. Move to the new
variables; legacy password-only cookies are rejected. Existing job files are packaged into ZIPs on startup and remain
available to the administrator until their retention expires. The old password must meet the
new 10–256 character limit.

## Qobuz sign-in and automatic session renewal

Sign into QWS as administrator, then open **Settings → Qobuz → Sign in to Qobuz**.
Enter your email/password on Qobuz's own site and complete any requested verification.
You return to QWS automatically; there is no token to copy or browser to install on
this server. No Qobuz credentials or authentication mode belong in `.env`.

Existing `QOBUZ_AUTH_MODE`, username/password, manual-token and app-key variables
are retired and ignored. Remove them from your private `.env`. An existing saved
OAuth session continues working after this update; deleting volumes is unnecessary.

The session is stored in `DATA_DIR/qobuz-session.json` with mode `0600`, in the
persistent `app-data` volume in Docker. Search/download workers receive it privately.
Credentials are never returned to the UI. Reauthentication replaces the common
server Qobuz account. A suitable account/subscription is still required.

A background check runs every minute. It attempts renewal after 30 minutes, or within
five minutes of expiry when the token provides a JWT expiry hint. Expiry parsing is
only a scheduling hint; account/subscription/signing checks authenticate each renewal.
The service calls the authenticated `user/login` endpoint and atomically saves the
returned token. This is best-effort renewal, not a guarantee of an unlimited session:
Qobuz does not provide us a separate refresh credential that can revive a revoked
session. If its response does not extend expiry, or it requests browser verification,
a new interactive sign-in may still be necessary.

Temporary network/client failures preserve the existing session and retry after
five minutes. Authentication rejection marks the session as requiring sign-in and
stops background retries until the administrator signs in again. Refreshes are
serialized; an older request cannot overwrite a newly connected account. Restarting
preserves renewal metadata; older two-field session files are renewed on startup.

Only administrators can initiate browser sign-in. The ten-minute, one-use callback
state is bound to an HttpOnly SameSite=Lax cookie and the initiating admin session;
regular QWS cookies remain SameSite=Strict. Restarting during browser sign-in requires
starting again. Under `/dl/`, set `NUXT_APP_BASE_URL=/dl/`, preserve Host and
X-Forwarded-Proto, and use the updated [nginx snippet](deploy/nginx-dl.conf) to disable
callback access logging. Apply equivalent logging rules at other reverse proxies.
The server needs HTTPS access to `play.qobuz.com` and `www.qobuz.com`, plus returned
media/cover destinations. The browser handles Qobuz's own verification services.

The former direct password API stopped working after Qobuz's April 2026 authentication
changes: see [qobuz-dl #329](https://github.com/vitiko98/qobuz-dl/issues/329),
[OAuth #331](https://github.com/vitiko98/qobuz-dl/pull/331), and
[streamrip #954](https://github.com/nathom/streamrip/issues/954).

## Search Qobuz tracks

In **Загрузки → Поиск Qobuz**, enter a song title or artist and press **Найти**.
Results show track/version, artist, album and duration. Select the tracks you want,
choose quality and retention, and add them to the queue. Unstreamable results cannot
be selected. **Показать ещё** loads more results, 20 at a time (up to 1000); select
up to 50 tracks per action. Each selected track becomes a separate owned job and ZIP.
If the queue fills or a request fails, successfully added tracks stay marked and the
remaining selection can be retried; leaving the search stops any remaining additions.

Search requires an app account and uses the existing server Qobuz credentials in
`web`, `token` or `mobile` mode. No extra keys or environment variables are needed.
It reads catalog metadata only, without modifying the downloader's configuration or sessions.
Requests run on explicit submission, with a 45-second timeout, one search per user and
two searches globally at once. Errors never include upstream response bodies or credentials.
Availability and actual download quality depend on Qobuz and the configured account.

## ZIP downloads and automatic expiry

Select **1–24 hours** when adding a download. `DOWNLOAD_RETENTION_HOURS` supplies the default.
The retention clock starts when the job finishes, including failed/cancelled jobs with partial files.
Each job uses a separate UUID directory. Its expiry time appears in the queue.
Use the **ZIP** link in the queue or the archive card in the library to download the whole job.
Downloads are available only as ZIP archives; source files are never served through the file API.

The queue and ZIP downloads use the artist and media title returned by OrpheusDL.
Names appear once the worker fetches metadata; until then, the UI shows the media type and Qobuz ID.
New audio files include the artist and track title, with track numbers inside albums/playlists.
ZIP names preserve Unicode. Existing files are not renamed; older job labels reuse their album folder
or single audio filename when available.

After the downloader stops, the queue automatically creates a ZIP64 archive, verifies its contents
and CRCs, and removes the originals, metadata sidecars and temporary files. Only the ZIP remains.
Audio is not recompressed; folder structure, filenames, artwork and supplementary files are preserved.
Symlinks are excluded and removed without following them. Packaging temporarily needs additional
space for the ZIP before originals can be deleted. The queue shows **Создаётся ZIP** until completion;
partial downloads from failed/cancelled jobs are archived as well.

If packaging or source cleanup fails, originals are kept where possible, the UI shows an error,
and **Повторить архивацию** / **Повторить** retries without downloading again. A commit marker
prevents an interrupted cleanup from replacing a full archive with the remaining subset of sources.
On startup, unfinished packaging and unexpired legacy job folders are converted/resumed automatically.
Manual directories that do not belong to recorded jobs are not modified or exposed by the archive UI.

At expiry, the application removes the job directory and its ZIP (and any leftovers from failed cleanup).
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
and tokens with restrictive permissions; the browser receives only setting-presence metadata for Qobuz credentials.
Logs are size-limited and redact configured secrets and URLs.

One Python downloader processes jobs in order. Cancellation stops its process group;
already written files are packaged into a ZIP, available until expiry.
After restart, interrupted jobs are marked failed and queued jobs resume.
The queue accepts up to 50 active jobs. Recent history keeps 200 records plus unexpired jobs
so archive cleanup is not lost. The archive library lists retained downloads.
OrpheusDL controls tagging and track availability. Detected individual-track failures mark
the job failed even if upstream exits with code 0.
The UI accepts media links and supports Qobuz track search.

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

## Safe session diagnostics

```sh
docker compose run --rm --no-deps --entrypoint node qws-dl /app/scripts/diagnose-qobuz.mjs
# Without Docker:
npm run diagnose:qobuz
```

The diagnostic uses only the saved OAuth session. It reports presence, fixed request
stages, HTTP statuses and a result category. No email, password, token, client key,
URL, response body or upstream exception text is printed. It does not modify the
session/configuration or download audio. A successful check validates the current
session and signing; it does not establish how long Qobuz will continue accepting it.
Exit status is 0 on success, 1 on failure. You can share the JSON for troubleshooting.
Legacy password-comparison options were removed along with the old authentication modes.
