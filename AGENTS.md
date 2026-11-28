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

## GitHub Releases

For each application release, increment stable SemVer in `package.json` and both
root version fields in `package-lock.json` (patch for fixes, minor for compatible
features, major for breaking changes). The newest `server/utils/news.mjs` entry
must have the same `version`, normal Russian content and an `english` object with
translated `title`, `summary` and `sections`. Describe changes since the previous
release; the first versioned release is a baseline, not a claim of past releases.
Do not create per-version changelog files in the repository. The Release workflow
publishes English descriptions, Russian Markdown, committed sources and checksums
as GitHub Release assets after validation. Never move an existing version tag or
replace a published release: fix errors in a new version. Always check the Release
workflow result after pushing a new version; a source commit alone is not a release.

## Modern Web Guidance

For HTML, CSS and client-side JavaScript, read
`.agents/skills/modern-web-guidance/SKILL.md` (or the global installation), then
search/retrieve relevant guidance before editing. Restore the skill with
`DISABLE_TELEMETRY=1 npx -y modern-web-guidance@latest install`; provenance is in
`skills-lock.json`. Keep telemetry disabled and do not add the CLI to application
dependencies. Apply alongside DESIGN.md, Taste and Unslop.

Browser support: Baseline Widely Available for required functionality; newer
features must progressively enhance a working fallback without new dependencies.
Keep grid disclosure fallback, native dialog focus behavior and reduced motion.
Do not opt into origin trials or volatile APIs. The guide does not justify
backend rewrites or weaker account isolation, no-store headers or CSP.

## Delegated development graph

For repository development, use [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md) and
`.agents/skills/project-orchestration/SKILL.md`. The primary agent coordinates as
PM and delegates implementation to role-specific subagents, with independent leads
validating analysis, development, QA, security, release material and integration.
PM may implement an explicitly marked small task only with another actor's review.
Any failed gate/check, expired assignment or stale candidate returns to ANALYSIS;
three unsuccessful cycles block delivery. Never override FAIL to publish.

Use `scripts/agent-flow.mjs` to record tasks, assignments, evidence and decisions.
Read the documented CLI interface rather than inventing commands. The CLI does not
launch LLMs: PM uses the available native collaboration tools and must interrupt
cancelled agents. New `.codex/agents/*.toml` profiles are discovered by compatible
new Codex sessions; in existing Work sessions explicitly pass their instructions.
Keep PM, workers and leads within the seven-context limit. Role instructions and
actor IDs do not create separate sandbox permissions or authenticated identities.

All tracked edits, including release notes, finish before candidate freeze. Later
gates inspect the same staged tree/base and hash-verified evidence. Runtime state
belongs in ignored `.agent-workflows/`, never in Git, the release or Docker image.
Pure development-tooling changes do not bump the app version or show app news;
validate them with the separate Agent workflow CI even when Release skips a version.
