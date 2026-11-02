# Security notes

Reviewed on 2026-11-02.

## Uploaded audio and metadata

Uploaded tracks are parsed in a separate Python process. Before parsing, the CLI
installs OS limits of **512 MiB address space** and **30 CPU seconds**, preserving
any stricter inherited limit. Failure to install a limit aborts processing. The
queue also enforces a 90-second wall-clock deadline and existing disk budgets.
These resource limits require the Linux/POSIX Python runtime used by the Docker image.

Mutagen's pinned ID3 parser receives a scoped bounded-decompression adapter:
**8 MiB per compressed frame**, **16 MiB total decoded compressed frames per read**,
and **16 MiB advertised ID3 tag size**. The adapter affects only Mutagen ID3 parsing;
it does not replace the global zlib API. Both uploaded-audio processing and the
optional lyrics-enrichment reads use this guard. Oversized metadata is rejected
without publishing an archive; optional enrichment leaves the downloaded original intact.

Compose caps the entire Node/worker container at **2 GiB** by default, configurable
with `WEB_MEMORY_LIMIT`. This supplements the per-upload process limit. A plain
`npm start` deployment must provide its own overall service memory limit.
Regression tests cover compressed ID3v2.3/v2.4 frames, aggregate decoded size,
large advertised tags, actual MP3 uploads, and inherited OS resource limits.

## Authentication work

Session checks and logout compute the cookie digest once, independently of the
number of stored sessions. Login validates the 3–32-character ASCII username schema
before lookup and normalizes it once. Valid-shaped unknown users still take the
dummy password-verification path and receive the same generic login failure.
Regression tests enforce the digest budget with 10,000 sessions and reject oversized
or malformed login names before accessing the user list.

## Dependencies and artifact boundaries

Nuxt is updated to **4.6.3**, addressing the reported middleware-path and dev-server
advisories affecting 4.6.2. The lockfile refresh includes **node-forge 1.4.2** and
**serialize-javascript 7.1.4**. The previous note that a forge fix was unavailable
is obsolete. No forced Nuxt downgrade or cross-major transitive override is applied.

At review time `npm audit` still reports **14 dependency-graph entries: 12 Moderate
and 2 Low, with no High or Critical**. These overlap through three build-tool
advisories: `deepmerge` (GHSA-gcqx-w48m-w2h4), `glob` (GHSA-3g3m-2fjr-6pw4), and
`minimatch` (GHSA-g3hv-75wg-m249). Deepmerge has no patched published release;
patched glob/minimatch majors are outside the dependency ranges required by the
current tooling. npm's suggested forced fix downgrades Nuxt to 4.1.3, which is not
an acceptable remediation for this application. Recheck compatible upstream updates.

The Docker runtime copies the built `.output` artifact, not build-stage
`node_modules`. Regression HTTP tests verify that node-forge, listhen, deepmerge,
glob and minimatch are absent from the production package tree. Run production
through `npm start` or the supplied Dockerfile behind a TLS reverse proxy; do not
expose the development server as production. Artifact isolation limits runtime
exposure but does not patch dependencies used during development/builds.

## Pinned downloader adapters

The pinned OrpheusDL and Qobuz module are adapted at worker startup by
`scripts/worker_safety.py` and `scripts/qobuz_web.py`. Do not substitute the upstream
CLI for `scripts/run-orpheus.py`: direct invocation omits application TLS, path,
budget and pagination boundaries. The unused `protobuf==3.15.8` was removed from
`requirements-orpheus.lock`; older local virtual environments should uninstall it.
