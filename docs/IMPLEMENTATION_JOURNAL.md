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

---

## Workstream B — Windows Desktop (doctor.ts + find_node)

### Unit B1: doctor.ts Windows bugs (plan §4.6)
- `homeDir()`: USERPROFILE-first on win32 (was HOME-first → MSYS pseudo-home).
- `checkBinary()`: skip exec-bit check on win32 (meaningless on Windows).
- `checkToken()`: skip chmod-600 check on win32 (no-op; ACLs are the control).
- Network: `checkPort7777Listener()` branches to netstat+findstr on win32.
- Exported `homeDir` for testing; 5-test `doctor.test.ts` pins resolution.

### Unit B2: Tauri find_node() expansion (plan §4.7)
- `lib.rs find_node()`: probes nvm-windows (NVM_HOME + APPDATA\nvm), scoop
  (scoop\shims), volta (.volta\bin), fnm (fnm_multishells) beyond the 2
  Program Files paths + where.exe. (Rust not cargo-built locally — no
  toolchain; change is well-scoped and uses only stdlib + dirs crate.)

### Verification (Workstream B)
- `bun run typecheck` (CLI): clean. `bun test`: 161/166 (5 pre-existing).
- biome: clean for changed files.

---

## Workstream C — In-App Pet Generation

### Critical path: chroma-key pipeline (plan §5.4, Phase 5)
gpt-image-2 cannot emit alpha (background is auto/opaque only). The
chroma-key pipeline is therefore MANDATORY — generate on flat #00FF00,
key it out in post. Proven end-to-end with real sharp processing:

- `pet-contract.ts`: the immutable 8×9 grid spec (1536×1872, 192×208 cells)
  + per-state row/frame/duration table, matching the web validator and the
  CLI STATE_MAP row order.
- `chroma-key.ts`: Euclidean-distance key of the chroma bg → per-pixel
  alpha, with a feather band for anti-aliased edges. Zeros RGB at alpha=0
  so the transparency invariant holds.
- `extract-strip-frames.ts`: slices a generated strip into N cell-sized
  frames + chroma-keys each.
- `compose-atlas.ts`: assembles per-row frames onto a transparent 1536×1872
  canvas → lossless WEBP.
- `validate-atlas.ts`: the quality gate — grid-ratio check (mirrors
  submissions-validation.ts) + transparency invariant (no RGB residue
  under low alpha). Runs BEFORE write (plan §5.7 #5).

### Generation (plan §5.5-5.6, Phase 6)
- `imagegen.ts`: OpenRouter `POST /api/v1/images` client for gpt-image-2
  (MANDATORY model, no fallback). `background:"opaque"`, identity lock via
  `input_references`. Key never in error text. Cost estimate helper.
- `prompts.ts`: per-state prompt templates enforcing the flat chroma bg +
  "no gradients/no shadows" discipline + identity-lock instruction.
- `generate-pet.ts`: orchestrator (base → 9 identity-locked rows → compose
  → validate → write to ~/.petdex/pets/<id>/). Retries per row, progress cb.

### Sidecar integration (plan §5.7)
- `POST /generate` endpoint in server.ts: token-gate (X-Petdex-Update-Token,
  same envelope as /state), API key read from LOCAL key store
  (~/.petdex/runtime/openrouter-key) NEVER from request body, request body
  sanitized + capped, output validated before write.
- `sidecar/generate-pet.ts` shim: statically imported so the CJS bundle
  inlines the pipeline + sharp (dynamic import would be a runtime require
  against a non-shipped file).

### Verification (Workstream C)
- `bun test` (generation): **18 pass / 0 fail** — chroma-key, extract,
  compose, validate, prompts, cost estimate all exercised with real sharp.
- sidecar build: success, `/generate` + sharp symbols in the 153KB bundle.
- sidecar tests: 21 pass / 1 fail (pre-existing macOS platform test).
- biome: clean for changed files.

### Not done in v1 (documented scope limits)
- DPAPI-at-rest for the OpenRouter key (plan §5.7 #1): key file is plain
  JSON for now; documented trade-off. DPAPI via win-dpapi or a Rust Tauri
  command is a follow-up.
- The cost-guardrail UI confirmation (plan §5.7 #3): `estimatePetCost()`
  exists; the UI gate is pending the settings window (Workstream B polish).
- SSE streaming off (plan §5.5): deterministic pipeline needs final frame.

