# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root
- **`docs/adr/`**: read ADRs that touch the area you're about to work in

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-isolate-project-command-environments.md
│   ├── 0002-chat-only-tool-selection.md
│   ├── 0003-built-in-subagent-toggle.md
│   ├── 0004-enabled-models-toggles.md
│   ├── 0005-built-in-subagent-disable.md
│   ├── 0006-mcp-and-code-mode.md
│   └── 0007-oidc-as-a-second-login-door.md
├── app/
├── components/
├── hooks/
└── lib/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (chat-only tool selection), but worth reopening because…_

## Relationship to the topic notes

`AGENTS.md` → `## Topic Notes` maps each area of the code to a note in `docs/agents/` describing how that area works today (implementation). These ADRs record *why* a decision was taken. Read both before changing an area.
