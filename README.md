# QWS · OrpheusDL Web

[Русская версия](README.ru.md) · [Setup and configuration](INFO.md)

A Nuxt web interface for OrpheusDL and its Qobuz module. Search Qobuz tracks, albums and artists with cover art, or queue media links,
choose audio quality, view logs, cancel jobs, and download completed jobs as ZIP archives.
Accounts are invitation-only; each user has a personal invite code and an invitation limit.
The administrator manages accounts and can delete downloads from Storage.
Choose a file lifetime of **1–24 hours** per job; archives expire automatically. Source files are removed after ZIP verification.

## Disclaimer

QWS is an **unofficial web UI and process runner for third-party software**.
It does not independently provide access to downloading tracks from Qobuz,
grant service entitlements, supply accounts or subscriptions, or bypass access restrictions.
Authentication and media processing depend on OrpheusDL, its modules, and the libraries below.
Use your own eligible account and download only content you are authorized to access.
This project is not affiliated with or endorsed by Qobuz or the upstream projects.

## Quick start

```sh
cp .env.example .env
# Set ADMIN_USERNAME and ADMIN_PASSWORD.
docker compose up -d --build
```

Open port `3000` on the local host, choose **Sign in**, and use `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
Then open **Settings → Qobuz → Sign in to Qobuz** and enter your email/password on Qobuz’s site.
The session is saved and renewed automatically while Qobuz accepts it. No Qobuz credentials go in `.env`.
For a reverse proxy under `/dl/`, set `NUXT_APP_BASE_URL=/dl/` and use
[the nginx location snippet](deploy/nginx-dl.conf).

See **[INFO.md](INFO.md)** for all environment variables, deployment, storage and expiry,
local development, tests, troubleshooting, and known limitations.

## Third-party dependency notices

| Component                                                                                        | Role                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| [OrpheusDL](https://github.com/OrfiTeam/OrpheusDL)                                               | Download orchestration, media files and tagging  |
| [OrpheusDL Qobuz module](https://github.com/yarrm80s/orpheusdl-qobuz)                            | Qobuz media and metadata integration             |
| [qobuz-dl](https://github.com/vitiko98/qobuz-dl)                                                 | Web-client discovery and authentication; GPL-3.0 |
| [Nuxt](https://nuxt.com/) / [Vue](https://vuejs.org/)                                            | Web UI and server; MIT                           |
| [Node.js](https://nodejs.org/), [Python](https://www.python.org/), [FFmpeg](https://ffmpeg.org/) | Runtime and media tools                          |

These components retain their own copyrights and licenses. This notice does not
relicense upstream code. See [dependency and license details](INFO.md#dependencies-and-licenses)
and the lockfiles for exact versions and transitive dependencies.

UI development follows [DESIGN.md](DESIGN.md); repository instructions are in [AGENTS.md](AGENTS.md).

## Lyrics (LRCLIB)

Enable **Добавлять тексты песен** when adding links or tracks from search.
New jobs look up lyrics using only the downloaded track's artist, title, album
and duration. Audio and Qobuz credentials are never sent to LRCLIB. No API key
or additional Python dependency is needed. Allow outbound HTTPS to `lrclib.net`.

Only matching metadata and durations within two seconds are accepted; no fuzzy
search or automatic alternate-version matching is performed. Instrumentals and
missing lyrics are skipped. Synced lyrics take priority; ordinary lyrics are
used when timestamps are unavailable or invalid.

Before ZIP creation, FLAC/Vorbis/Opus files receive `LYRICS` and `SYNCEDLYRICS`,
MP3 receives ID3 `USLT` and `SYLT` (millisecond timestamps), and M4A receives
ordinary lyrics in `©lyr`. Synced tracks also include a UTF-8 `.lrc` file with
the same basename. Embedded synchronized lyrics support depends on the player;
the sidecar provides an additional compatibility option. Existing tags and audio
are preserved; tagging is performed on a temporary copy and replaced atomically.
Files without sufficient metadata or space for a safe copy are skipped.

Requests run serially with connection/read timeouts, redirects disabled and a
1 MiB response cap. Three consecutive failures stop further requests for the
job. Public results are cached in `DATA_DIR/lyrics.sqlite3` for 30 days, misses
for one day, with at most 512 entries of up to 128 KiB each (plus a 64-entry per-worker memory cache).
Network errors are not cached. Lyrics failures do not fail music downloads;
the job log records the outcome. Existing ZIP archives are not modified.

## Catalog search

The Tracks, Albums and Artists tabs share the query and keep separate results,
selections and pagination. Changing tabs searches automatically when needed;
returning to cached results does not repeat the request. Use arrow keys, Home
and End to navigate the tabs. Artwork is loaded lazily from public HTTPS URLs
on `static.qobuz.com`, without a referrer, with a fallback for missing or broken images.
Albums show their release year and track count when supplied by Qobuz. Artists
show their photograph and album count when available. Selecting an artist queues
their entire available discography in one job, as stated in the interface.
Quality, retention and the optional LRCLIB lyrics setting apply to every type.
