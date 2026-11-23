# QWS · OrpheusDL Web

[Русская версия](README.ru.md) · [Setup and configuration](INFO.md)

A Nuxt web interface for OrpheusDL and its Qobuz module. Search Qobuz tracks, albums and artists with cover art, or queue media links,
choose source quality and output format, view logs, cancel jobs, and download completed jobs as ZIP archives.
Accounts are invitation-only; each user has a personal invite code and an invitation limit.
Users can manually delete their own archives from Archives, with confirmation; download history remains.
The administrator manages accounts and can delete any download from Storage.
Choose **1–24 hours** or **1–15 completed downloads** per job; counted archives also expire after one week by default (admin configurable from 1 hour to 30 days). Archives are removed when either limit is reached. Administrators can save application defaults in Settings. Source files are removed after ZIP verification.

## Versioned releases

[GitHub Releases](https://github.com/DoshikKing/qws-dl/releases) contains version
tags (`vMAJOR.MINOR.PATCH`), English change descriptions, a link to Russian notes,
a `qws-dl-vX.Y.Z-source.tar.gz` archive, and `SHA256SUMS`. Extract the archive,
copy `.env.example` to `.env`, set administrator credentials and run
`docker compose up -d --build`. The archive contains committed sources only;
Docker builds the full runtime locally. It is not a prebuilt application binary.

To publish the next version, increment `package.json` and the matching root fields
in `package-lock.json`, then add a news entry in `server/utils/news.mjs` with the
same `version` and its English translation in `english`. Push to `main`: the
**Release** workflow checks types, runs Node tests, builds the app and publishes the
tag and assets. An already published version is left intact; a failed draft can
be retried from Actions → Release → Run workflow at the same commit. Release
Markdown files are generated as assets and are not accumulated in the repository.
The initial version is a snapshot of current features; earlier history remains in Git.

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
| [Monkey’s Audio SDK](https://github.com/sbooth/CXXMonkeysAudio) / [SoX DSD](https://github.com/mansr/sox) | APE and DSD64 encoding; BSD-3-Clause and GPL/LGPL |
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

## Lyrics for uploaded audio

The **Тексты** section accepts one FLAC, MP3, M4A, Ogg or Opus file up to 100 MiB,
without a Qobuz session. Tags supply artist, title and album; optional form fields
override the lookup metadata. A matching LRCLIB result is embedded, and the ZIP
contains the audio plus an identically named UTF-8 `.lrc`. Plain lyrics have no
invented timestamps and are identified as unsynchronized. Missing matches or invalid
audio produce an explicit error. Choose **1–5 hours** after completion or deletion after **1–15 completed downloads**, also subject to the admin-configured counted archive TTL.
Raw server copies are removed after ZIP verification, on failed/interrupted
processing or after a restart during processing. Your local original is unchanged.
Only lookup metadata, never uploaded audio, is sent to `lrclib.net`. Allow outbound
HTTPS to that host. The existing archive authorization and account quotas apply.


## Output formats

Before adding Qobuz links or catalog items, choose **Формат файла**: original
(default), MP3, AAC/M4A, Vorbis/OGG, Opus, APE, ALAC/M4A, DSD/DSF or TTA.
Expand **Настройки формата** to adjust supported bitrate/VBR quality, compression,
PCM bit depth/sample rate or DSD64/128/256 and headroom. Settings are kept per
format while switching between link and catalog forms; Reset restores defaults. Source quality remains independent; prefer FLAC
when converting. Lossless formats do not restore quality lost in MP3; PCM-to-DSD
does not improve the source. Converted tracks retain common tags, artwork and
lyrics, with LRC sidecars where available. Conversion happens once before ZIP
creation; single-track retries inherit the format. Existing ZIPs stay unchanged.
Docker builds include the additional APE/DSD encoders. Without Docker, install
CMake and a C++ compiler, then run `npm run setup:codecs`. See [details](INFO.md#output-conversion).


## Update news

After signing in, a new release shows an in-app notification once. Click it for
detailed notes, or open **Новости** in the toolbar at any time. Closing the
notification or reader dismisses that release for your account across logins and
devices. A new release can notify again. No browser notification permission is required.


Administrators can see the Qobuz subscription period in the page-heading indicator
and in Settings: end date, remaining days and known auto-renewal status. A warning
appears within seven days. Missing dates or stale data are labelled explicitly;
this is not inferred from token expiry. Ordinary users do not receive these details.
