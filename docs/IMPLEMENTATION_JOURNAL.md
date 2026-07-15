# Implementation Journal — ZCode Support, Windows Desktop, In-App Pet Generation

Tracking implementation of `docs/implementation.md`. See the plan for full
context; this journal records decisions, test results, and per-unit status.

## Phase 0/1 — Intake & Reconnaissance (2026-07-15)

### Resolved decisions (from maintainer)
- **Workstreams:** all three (A + B + C).
- **ZCode config path:** user-scope `~/.zcode/cli/config.json` (the path the
  authoritative `diagnosing-hooks` skill specifies). The file is absent on
  this machine only because no hooks have ever been written; `installForAgent`
  creates the dir + file. Avoids the workspace-config design divergence.
- **Toolchain:** install Bun to satisfy the skill's verification gate.

### Toolchain note
No bun/node/cargo was present. Installed Bun 1.3.14 via proxy
`127.0.0.1:10808`. `cargo`/`rustc` is NOT installed → Workstream B Rust
changes can be authored but not `cargo build`-verified locally.

### Baseline (before any source edit)
- `bun run typecheck` (CLI): clean.
- `bun test src/hooks/` (CLI): 81 pass / 5 fail. The 5 failures are
  **pre-existing platform issues** (tests run POSIX `/bin/sh` + assert Unix
  `0600` modes + Unix `/home/...` paths). They are NOT code regressions and
  pass on macOS/Linux. Baseline confirmed before changes.

### Key codebase facts (verified by reading)
- `agents.ts` is the canonical registry; `AGENTS` iterated generically by
  install/uninstall/doctor/refresh.
- `bubbleHookCommand` (POSIX shell) — NOT reusable for ZCode (Windows).
- `bubble-runner.ts` reads `args[0]=phase, args[1]=agentSource`; the ZCode
  process hook passes `[petdex.js, bubble, phase, agentSource, state, duration]`,
  which after `args.slice(1)` becomes `[phase, agentSource, state, duration]`.
- `isPetdexEntry` exists in BOTH `install.ts` and `uninstall.ts` (duplicated).
- `collectCommands` splits argv elements into SEPARATE strings → the path and
  "bubble" land in different strings. Detection must match across the set,
  not within a single string. (Caught during testing.)

---

## Workstream A — ZCode Agent Support

### Unit A1: Registry entry (`agents.ts`)
- Added `"zcode"` to the `Agent["id"]` union.
- Added the AGENTS entry: 7 hookEntries, `build()` emits
  `hooks.events.<Event>` nesting + `enabled:true` + `type:"process"` per hook.
- Added `bubbleProcessHook(phase, state, duration?)` helper: emits strict
  `{type:"process", command:"node", args:[petdex.js,"bubble",phase,"zcode",state,duration?], timeoutMs:60000}`.

### Unit A2: bubble-runner `error` phase + `session.error` template
- `stateForEvent`: added `if (phase === "error") return "failed"`.
- `eventFromArgs`: added `if (phase === "error") return {kind:"session.error"}`.
- `bubble-templates.ts`: added `session.error` BubbleEvent variant →
  "Something went wrong." bubble.

### Unit A3: Custom ZCode merge (`installForAgent`)
- New `installForZcode()` branch in `install.ts`: preserves
  `hooks.{enabled,timeoutMs,maxOutputBytes}` and merges per-event inside
  `hooks.events` (the generic `mergeHooks` flattens that nesting — a real bug).

### Unit A4: Detection (`isPetdexEntry`) — install.ts + uninstall.ts
- Both copies updated: detect ZCode process-form by checking the collected
  command strings for BOTH a `.petdex/bin/petdex.js` path AND the literal
  `"bubble"` arg (across the set, since argv elements are split).
- `stripPetdexHooks` (uninstall.ts): now recurses into `hooks.events` so
  ZCode nested entries are stripped, not passed through.

### Unit A5: doctor detection
- `checkHooksInstalled`: ZCode branch matches `petdex.js` + `bubble` in the
  config text (the sidecar URL isn't in the argv).

### Unit A6: Tests
- `agents.test.ts`: 13-test `describe("ZCode agent")` block — build shape,
  7 events under `hooks.events.*`, `enabled:true`, strict process field set,
  agent_source, phase/state args, killswitch-not-in-argv, JSON round-trip.
- `zcode.test.ts`: 8 tests — `isPetdexEntry` recognizes process-form (real
  built entries), doesn't false-match, still detects shell-form; plus
  `stripPetdexHooks` nested-events strip + preserve-user-keys.

### Verification (Workstream A)
- `bun run typecheck` (CLI): **clean**.
- `bun run build` (CLI): **success** (102 modules, 0.29 MB).
- `bun test src/hooks/`: **101 pass / 5 fail** (5 = pre-existing platform).
- `bun run check` (biome): **clean** for changed files (2 pre-existing
  `noExplicitAny` warnings in untouched `process.test.ts`).
