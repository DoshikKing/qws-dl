# Repository instructions

Before changing any UI, read and follow [DESIGN.md](DESIGN.md). Refer to that guide
when making layout, copy, accessibility, or animation decisions. Keep it updated
when the user explicitly changes the design direction.

Run the checks relevant to the change. For account/security changes, test server-side
permissions and isolation as well as the visible UI. Keep secrets out of source,
logs, screenshots, tests, and commit messages. Use fixture credentials in tests.

This application runs as one Node process/replica with a serialized Orpheus worker.

## Release notes

Every application update must add a new entry at the start of
`server/utils/news.mjs` with a unique stable id, release date and factual
user-facing changes. Never reuse an announced id for a new update: per-user
dismissal is keyed by that id. Keep newest entries first and at most 50 entries.
Do not include secrets, internal credentials or unverified claims in release notes.
