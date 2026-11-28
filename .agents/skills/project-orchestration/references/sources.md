# Sources and adaptation record

Reviewed on 2026-11-27. These are reference inputs for the project's compact role
and process adaptations. This workflow does not install the upstream frameworks,
run their installers, or import their complete agent catalogs. Local instructions
are maintained for QWS rather than tracking upstream automatically. The license
text in [third-party-notices.md](third-party-notices.md) is reproduced verbatim;
local role descriptions and process rules are adaptations.

## Immutable upstream references

| Source | Pinned commit | Applicable material |
| --- | --- | --- |
| [Superpowers](https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7) | `22f0b463e7a5e579904dd6211a520321035526f7` | Focused task delegation, independent review, evidence before completion |
| [Agency Agents](https://github.com/msitarzewski/agency-agents/tree/8ae6164602c95ca78828b148b9052460ee426885) | `8ae6164602c95ca78828b148b9052460ee426885` | PM task decomposition, explicit handoffs, stage validation and bounded retries |
| [Agents by Seth Hobson](https://github.com/wshobson/agents/tree/c96b5f6552dba32e4492307493ee613581430715) | `c96b5f6552dba32e4492307493ee613581430715` | Practical security-review scope and evidence-based findings |

The reviewed files are:

- Superpowers:
  [subagent-driven-development](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/subagent-driven-development/SKILL.md),
  [dispatching-parallel-agents](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/dispatching-parallel-agents/SKILL.md),
  [verification-before-completion](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/verification-before-completion/SKILL.md),
  [MIT license](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE).
- Agency Agents:
  [Senior Project Manager](https://github.com/msitarzewski/agency-agents/blob/8ae6164602c95ca78828b148b9052460ee426885/project-management/project-manager-senior.md),
  [Agents Orchestrator](https://github.com/msitarzewski/agency-agents/blob/8ae6164602c95ca78828b148b9052460ee426885/specialized/agents-orchestrator.md),
  [MIT license](https://github.com/msitarzewski/agency-agents/blob/8ae6164602c95ca78828b148b9052460ee426885/LICENSE).
- Agents by Seth Hobson:
  [security auditor](https://github.com/wshobson/agents/blob/c96b5f6552dba32e4492307493ee613581430715/plugins/security-scanning/agents/security-auditor.md),
  [MIT license](https://github.com/wshobson/agents/blob/c96b5f6552dba32e4492307493ee613581430715/LICENSE).

## Deliberate project adaptations

- Every failed stage returns to analysis. A direct dev/QA retry loop from an
  upstream template does not replace this routing rule.
- Retry exhaustion blocks the task. An unresolved or parked finding cannot be
  counted as a passing gate or silently carried into publication.
- PM coordinates and accepts the result; small PM-authored changes require a
  different review author. Reviewers do not fix and approve their own changes.
- Evidence must identify the task, candidate revision, actual checks and result.
  A worker's completion message alone is insufficient.
- Parallelism follows independent tasks and available capacity. Shared files and
  sequential dependencies require coordination or serialization.
- Preserve the existing Nuxt/Vue, Node and Python architecture. Do not import
  Laravel, Livewire, FluxUI, stock image policies, hard-coded model selection
  (including `model: opus`), or unrelated cloud/compliance services from templates.
- Existing user authorization and project instructions take precedence over
  upstream approval habits. Publication still requires the project's quality
  gates; already authorized GitHub publication does not need repeated permission.
- Existing Taste, Unslop and Modern Web Guidance rules continue to apply to UI
  work. These orchestration references do not replace those design rules.

## Official Codex configuration references

Primary documentation checked on 2026-11-27:

- [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
  (the current destination of
  [developers.openai.com/codex/multi-agent](https://developers.openai.com/codex/multi-agent)).
- [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
  (the current destination of
  [developers.openai.com/codex/config-reference](https://developers.openai.com/codex/config-reference)).

Documented project-scoped role discovery uses `.codex/agents/<role>.toml`.
Standalone agent files require `name`, `description` and
`developer_instructions`. Omitting model and reasoning overrides preserves the
parent selection. Global subagent settings use `[agents]` in
`.codex/config.toml`: `enabled` and
`max_concurrent_threads_per_session` are supported keys. The latter excludes the
primary thread; a value of six represents six subagents plus one coordinator.
`max_threads` is a legacy alias. Actual host/tool limits still take precedence.

A custom role inherits the parent's permissions, provider and MCP configuration.
Calling an agent read-only in its instructions is a behavioral policy, not a
separate read-only sandbox. A role's `sandbox_mode`, `approval_policy`,
`model_provider` or `mcp_servers` cannot override the parent's settings.

In an already-running ChatGPT Work session, use the available collaboration tools
and explicitly include the assigned role instructions in each task. Do not assume
that creating TOML files dynamically changes the current session's tools, loads a
new role selector, or starts a persistent background service. Native discovery is
for compatible Codex sessions; stored workflow state and the coordinator's actual
tool actions are separate responsibilities.
