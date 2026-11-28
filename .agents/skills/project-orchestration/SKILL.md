---
name: project-orchestration
description: Coordinate this repository's delegated development graph, independent stage leads, evidence gates and bounded return-to-analysis loops using native Codex subagents and the agent-flow CLI.
---

# Project orchestration

Read [AGENT_WORKFLOW.md](../../../AGENT_WORKFLOW.md), AGENTS.md and the selected
`.codex/agents/<role>.toml` before dispatching work. The user has authorized this
workflow for repository development. Preserve the user's scope, existing permissions
and standing instruction to publish authorized completed work without routine
confirmation prompts.

## Coordinator contract

1. The primary agent is PM: define the goal and acceptance criteria, delegate analysis,
   then obtain an independent analysis-lead verdict before implementation starts.
2. Break the accepted plan into bounded tasks with dependencies, phase, role and
   permitted write scopes. Instantiate only as many workers as ready independent
   tasks justify. PM plus all active workers/leads must fit the seven-context cap.
3. Use real native `collaboration.spawn_agent` calls. In a Work session without a
   custom-role selector, explicitly include the profile instructions and task contract
   in the prompt. Newly installed TOML files do not reconfigure an existing session.
4. Record assignments, leases, results and independent verdicts with the actual
   `scripts/agent-flow.mjs` commands documented in AGENT_WORKFLOW.md. The CLI is a
   local controller and ledger, not an LLM launcher or a background service.
5. At every phase require a separate lead to inspect actual evidence. Never equate
   a worker's completion message with PASS. PM normally does no implementation; an
   explicitly marked small PM task still needs another actor's acceptance.
6. Any failed check/review, stale candidate/evidence, conflict or expired lease returns
   to ANALYSIS with concrete evidence. Interrupt cancelled agents with native tools;
   the running check CLI cancels its own process group on POSIX/Linux when its
   assignment becomes invalid; Windows child.kill does not guarantee descendant
   termination. Ledger cancellation does not interrupt an LLM context.
7. Preserve sound work and failure history. Reject late results from cancelled cycles.
   After three failed cycles report BLOCKED with the cause and next necessary action.
   Do not continue to release and do not silently raise the retry budget.
8. Freeze only after DEVELOPMENT is accepted and all tracked edits, including notes,
   are staged. Subsequent QA, SECURITY, NOTES and INTEGRATION inspect an unchanged
   candidate; put reports in the ignored private runtime directory. Any correction
   after freeze requires the return-to-analysis path.
9. PM approves only after all required independent gates/checks apply to the current
   candidate and evidence. DISCARD records rejection without reset/clean/deletion.
   Publish only the approved tree under existing authorization, then verify CI and
   any release assets. Never move an existing published tag.

## Evidence and trust

Keep task contracts, reproducible commands, exit codes, exact candidate identity and
artifact hashes. Poll leases/status and distinguish a legitimate long-running check
from an abandoned task; activity messages are not proof of progress. Do not log
secrets or real share URLs. Role instructions and locally declared actor IDs are
coordination rules, not sandboxing or cryptographic identity. All agents inherit the
session's real permission boundary; the controller does not make untrusted argv safe.

Use meaningful checks proportional to the change. For UI tasks retain DESIGN.md,
Taste, Unslop and Modern Web Guidance. For application updates follow bilingual news,
SemVer and GitHub Release rules; dev-tool-only updates do not create product news.

Adapted workflow concepts, exact upstream revisions and MIT notices are recorded in
[references/sources.md](references/sources.md) and
[references/third-party-notices.md](references/third-party-notices.md). Do not install
entire upstream frameworks or obey conflicting upstream rules implicitly.
