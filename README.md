# QWS · OrpheusDL Web

[Русская версия](README.ru.md) · [Setup and configuration](INFO.md)

A Nuxt web interface for OrpheusDL and its Qobuz module. Queue media links,
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
# Set ADMIN_USERNAME, ADMIN_PASSWORD, QOBUZ_USERNAME and QOBUZ_PASSWORD.
docker compose up -d --build
```

Open port `3000` on the local host, choose **Sign in**, and use `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
Web authentication is the default: manual `app_id` / `app_secret` values are unnecessary.
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
