# Implementation Plan: ZCode Support, Windows Desktop, and In-App Pet Generation

> **Status:** Planning document only. No source edits have been made.
> **Scope of investigation:** CLI hooks system, desktop native app + sidecar, `openai/skills` `hatch-pet` skill, OpenRouter image API, ZCode hook format, Windows 11 overlay window options.
> **Date:** 2026-07-14
>
> ---
>
> ### Audit log (2026-07-14)
>
> A principal-engineer audit re-verified every concrete claim against the live codebase, the installed ZCode skill docs, and OpenRouter's live API. Corrections made:
>
> 1. **ZCode config path was asserted but not verified.** The draft said "this machine's file currently has no `hooks` key" for `~/.zcode/cli/config.json` — that file **does not exist** on this machine (real config: `~/.zcode/v2/config.json`; no `commands/` dir exists either). Marked the path unresolved; recommend workspace-scope config for v1. (§3.2, §3.4-A, §6 #1)
> 2. **ZCode config merge was marked "verify, don't assume" but the default path is demonstrably wrong.** `mergeHooks` flattens ZCode's nested `hooks.events` shape. A custom merge branch is **required**, not optional. (§3.4-B, new §3.5.1)
> 3. **Detection ("no changes required") was wrong.** A Windows-safe `type:"process"` hook has no `:7777/state` substring, so `isPetdexEntry` won't recognize our own hooks → re-install duplicates, uninstall/doctor silently miss them. Added required detection update. (§3.4-D, §3.4-F)
> 4. **Windows shell compatibility promoted from "open question" to required.** POSIX `bubbleHookCommand` under `type:"command"` breaks on Windows; `type:"process"` is mandatory. (§3.4-A, §6 #2)
> 5. **gpt-image-2 transparency claim upgraded to authoritative.** Confirmed `background: ["auto","opaque"]` via live `GET /api/v1/images/models`; also confirmed gpt-image-1/-mini support `transparent`. Added gpt-image-1-mini as a cheaper default candidate the draft omitted. (§2.5, §5.4)
> 6. **OpenRouter endpoint firmed up.** `POST /api/v1/images` (OpenAPI `/images`, not OpenAI's `/images/generations`); `background` is top-level; SSE streaming exists but should stay off initially. (§5.5)
> 7. **Security model expanded.** Added DPAPI-at-rest, token-gating `POST /generate`, cost guardrail, output validation before write. (§5.7)
> 8. **Pet output path corrected** to `~/.petdex/pets/` (primary root for both shells) — draft said `.codex/pets/`. (§5.3)
> 9. **Node-discovery claim corrected.** `find_node()` checks only 2 Program Files paths + `where`, not nvm/scoop/fnm. (§4.7, §6 #7)
> 10. **Win32 transparency caveat strengthened** — Tauri `transparent:true` is necessary not sufficient; layered-window + ARGB DIB needed for clean edges. (§4.4)
>
> Claims that were **verified correct** and left as-is: the 7 ZCode events + schema, the agent-registry extension point, the Tauri scaffold existence + binary name + window flags, all four `doctor.ts` Windows bugs at their cited lines (32, 54-62, 204-212, 455), `agent_source` free-form text at `schema.ts:680`, the 8×9/8×11 atlas validation, and `sharp`/`gifenc` already being dependencies.
>
> ### Audit log — amendment (2026-07-14, model requirement)
>
> Maintainer correction: **`openai/gpt-image-2` is mandatory and the ONLY allowed model for pet generation — do NOT fall back to `gpt-image-1` or `gpt-image-1-mini`.** Re-verified against the live per-provider endpoint `GET /api/v1/images/models/openai/gpt-image-2/endpoints`: `background` is `["auto","opaque"]` (no transparent), but `input_references` 0–16 IS supported (so the identity lock works). Consequence: the C-1/C-1b/C-3 fallback options have been **removed**; the chroma-key pipeline is **mandatory and on the critical path** (§2.5, §5.4, §5.5, §7). Build Order Phase 5 is now a prerequisite for Phase 6, not parallelizable.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Key Findings That Shape Every Plan](#2-key-findings-that-shape-every-plan)
3. [Workstream A — Full ZCode Agent Support](#3-workstream-a--full-zcode-agent-support)
4. [Workstream B — Windows 11 Desktop Integration](#4-workstream-b--windows-11-desktop-integration)
5. [Workstream C — In-App Pet Generation (hatch-pet replication)](#5-workstream-c--in-app-pet-generation-hatch-pet-replication)
6. [Cross-Workstream Decisions To Confirm](#6-cross-workstream-decisions-to-confirm)
7. [Suggested Build Order](#7-suggested-build-order)
8. [Research Sources](#8-research-sources)

---

## 1. Executive Summary

Three demands were investigated against the current codebase. All three are feasible, and two of them have more groundwork already in place than the README implies.

| Demand | Feasible? | Effort | Key enabler already present |
| --- | --- | --- | --- |
| **A. ZCode hooks support** | ✅ Yes — small, localized | Low (≈1 day) | The `AGENTS` registry is generic; a new entry is self-contained. |
| **B. Windows 11 desktop** | ✅ Yes — medium/large | Medium-Large | A **Tauri/WebView2 scaffold already exists** at `packages/petdex-desktop-windows/` (unreferenced). The CLI already handles Windows install/process/`taskkill`/`.exe`. |
| **C. In-app pet generation** | ✅ Yes — but with a caveat | Large | The `hatch-pet` workflow is fully documented and deterministic. `gpt-image-2` is on OpenRouter — **but it lacks native transparency**, so the chroma-key pipeline must be ported. |

**The single most important cross-cutting finding:** ZCode's hook system is **not** a clone of Claude Code's. It has exactly **7 events** and is missing `Notification` and `SubagentStop`, which the existing Claude Code entry relies on. The `STATE_MAP` in the CLI must be adapted, not copied.

---

## 2. Key Findings That Shape Every Plan

### 2.1 The agent registry is the single point of extension

`packages/petdex-cli/src/hooks/agents.ts` is the canonical registry. The file header states the contract explicitly:

> *"Adding a new agent means: configDir + configFile + hookEvents. The wizard handles detection, multi-select, and write/restore generically."*

Everything else — `detectAgents()`, `runInstall()`, `runUninstall()`, `runDoctor()`, `runRefresh()` — iterates the `AGENTS` array generically. A new agent entry is largely self-contained. **No backend or DB change is required** because `agent_source` is free-form text (clipped to 64 chars) in both the sidecar and the `telemetryEvents` table (`src/lib/db/schema.ts:680`).

The internal canonical events (`EventKind`) and their sprite-state mapping (`STATE_MAP`) are:

| `EventKind` | `PetState` | Sprite row |
| --- | --- | --- |
| `tool.before` | `running` | 1/2 |
| `tool.after` | `idle` | 0 |
| `session.end` | `waving` | 3 |
| `session.error` | `failed` | 5 |
| `session.waiting` | `waiting` | 6 |
| `user.prompt` | `jumping` | 4 |

### 2.2 Detection = configDir existence; identification = sidecar URL string

- `detectAgents()` (`install.ts:39`) returns true iff `agent.configDir` exists on disk.
- `isPetdexEntry()` (`install.ts:336`) recognizes our own hooks by searching for the substring `localhost:${PETDEX_PORT}/state` or `SIDECAR_URL` inside the command string. **A new agent's generated command must embed `http://127.0.0.1:7777/state` or it will not be detected for uninstall/doctor.** `bubbleHookCommand()` already does this, so any JSON-hooks agent using it is covered automatically.

### 2.3 A Windows desktop scaffold already exists

`packages/petdex-desktop-windows/` is a **Tauri 2 (Rust) + WebView2** project that re-implements the core loop: pet scanner, active-slug reader, sidecar spawner, and a CSS sprite renderer. Its `Cargo.toml` binary name is `petdex-desktop-win32-x64` — **exactly the asset name the CLI's `install.ts` already looks for**. It is simply not wired into any release script or CLI path yet. It is a starting point, not a finished port (missing: momentum drag, picker, deep-links, update card, settings window).

This reframes Workstream B from "build a Windows app" to "finish the existing scaffold and wire it into release + CLI."

### 2.4 The desktop app is already architected cross-platform

The desktop is split into a **native shell** (Zig+WebKit on macOS) and a **cross-platform Node.js sidecar** (`sidecar/server.ts`). The sidecar writes JSON files to `~/.petdex/runtime/` (`state.json`, `bubble.json`); the native shell polls them every 200ms via a JS bridge. The HTTP contract (`POST /state`, `POST /bubble` on `:7777`) and the file-based IPC are platform-independent. Only the **native shell** and the **macOS-only in-app self-updater** need Windows equivalents.

### 2.5 `gpt-image-2` lacks native transparency — this shapes Workstream C

**Confirmed authoritatively** against OpenRouter's live endpoints (retrieved 2026-07-14):
- `GET /api/v1/images/models` (discovery)
- `GET /api/v1/images/models/openai/gpt-image-2/endpoints` (per-provider detail)

`openai/gpt-image-2` supported parameters:

| Parameter | Value |
| --- | --- |
| `quality` | `auto`, `low`, `medium`, `high` |
| `background` | `["auto", "opaque"]` — **no `transparent`** |
| `n` | 1–10 |
| `input_references` | **0–16** (identity lock works) |
| `output_compression` | 0–100 |
| `supports_streaming` | true |
| pricing | `output_image` @ $0.00003/token |

**Per the maintainer's hard requirement, `openai/gpt-image-2` is the ONLY allowed model for pet generation — no fallback to `gpt-image-1`/`gpt-image-1-mini`.** (Those models do support `background: "transparent"`, but they are out of scope by requirement.)

The consequence is decisive: because gpt-image-2 **cannot emit alpha**, the **chroma-key pipeline is mandatory, not optional**. We generate every image on a flat chroma-key background and deterministically key it out in post (exactly what `hatch-pet` does with `extract_strip_frames.py` and `validate_atlas.py`). The good news from the endpoint check: `input_references` (0–16) is fully supported, so the **identity lock** (passing the canonical base as a reference on every row strip) works on gpt-image-2. Transparency is the only missing capability, and chroma-keying covers it.

### 2.6 ZCode's hook events differ from Claude Code's

ZCode supports **exactly 7 events**: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Stop`.

It **does not** support `Notification` or `SubagentStop` (which the Claude Code entry uses), and it **adds** `PermissionRequest` and `PostToolUseFailure`. Configuration-file hooks are **disabled by default** and must be enabled with `"hooks": { "enabled": true }`. Matcher is a **case-sensitive regex** (so `"bash"` will not match `Bash`).

---

## 3. Workstream A — Full ZCode Agent Support

### 3.1 Goal

Add `zcode` as a sixth supported agent in `petdex init` / `petdex hooks install`, so the desktop floater reacts to ZCode activity the same way it does for Claude Code or Codex.

### 3.2 Ground truth: ZCode's hook format

Investigated from the authoritative `zcode-guide` skills installed locally (`C:\Users\predator\.zcode\cli\plugins\cache\zcode-plugins-official\zcode-guide\...`). **The seven events and the schema below are authoritative. The exact on-disk config path is NOT yet confirmed — see the ⚠️ callout.**

**Config locations the skill docs specify (in priority order):**
1. User: `~/.zcode/cli/config.json` ← **per the skill docs**
2. Workspace: `<repo>/.zcode/config.json` (or `<repo>/zcode.json`) ← petdex has no `.zcode/` dir today
3. UI prefs (not for hooks): `~/.zcode/v2/setting.json`

> ⚠️ **Config-path discrepancy (must resolve before coding).** The skill docs say the user config is `~/.zcode/cli/config.json`, but on *this* Windows machine that file **does not exist**. What exists is `~/.zcode/v2/config.json` (holds `provider`, MCP, plugin state) and `~/.zcode/v2/setting.json`; the `~/.zcode/cli/` tree contains only runtime data (`agents/`, `artifacts/`, `db/`, `log/`, `plugins/`). There is also **no** `~/.zcode/commands/` or `~/.zcode/cli/commands/` directory. The earlier draft's claim "this machine's file currently has no `hooks` key" was **not actually verified** — that file isn't there. Treat the user-scope path as unresolved and confirm against the running ZCode version (it may have moved config to `~/.zcode/v2/config.json`, or `cli/config.json` may be created lazily on first hooks write). **Until resolved, prefer the workspace config** (`<repo>/.zcode/config.json`) which is documented, version-controllable, and avoids guessing the user-scope location. This is the single biggest unknown in this workstream.

**Schema (configuration-file form — note the `events` nesting):**
```jsonc
{
  "hooks": {
    "enabled": true,            // REQUIRED — config-file hooks are off by default
    "timeoutMs": 60000,
    "maxOutputBytes": 1000000,
    "events": {
      "<Event>": [
        {
          "matcher": "Bash",    // case-sensitive regex; omitted = match all
          "hooks": [
            {
              "type": "command",                        // runs through a shell
              "command": "echo hi",
              "timeout": 30,                            // seconds
              "timeoutMs": 5000,                        // ms — takes precedence
              "statusMessage": "petdex running…"
            }
          ]
        }
      ]
    }
  }
}
```
(A plugin's `hooks/hooks.json` uses the same inner array but under the outer `hooks` wrapper directly — no `events` key. We are writing **configuration-file** hooks, so the `hooks.events.<Event>` form above is the one we must emit.)

**Entry types:**
- `"type": "command"` — `command` is a shell string. **POSIX shell syntax fails on Windows**, so for cross-platform hooks prefer `"type": "process"`. This is not optional for the ZCode entry given the Windows target (see §3.6 #2).
- `"type": "process"` — `command` (executable) + `args[]` (argv, no shell). Most portable; **required for the Windows path.** Field set is strict: a `process` hook accepts **only** `command`, `args`, `timeoutMs` — mixing in `shell`/`timeout` causes the hook to be **dropped silently**.

**Template variables** (expanded in `command`/`args`, also injected as env vars): `${ZCODE_PROJECT_DIR}` (also `${CLAUDE_PROJECT_DIR}`), `${CLAUDE_SESSION_ID}`. Plugin-only vars (`${CLAUDE_PLUGIN_ROOT}`) are **not** available to configuration-file hooks — do not use them.

**Output contract:** stdout parsed as JSON (strict schema — any extra key fails validation), or exit codes: `0` = pass, `2` = block/deny, other non-zero = error. Our hooks must **always exit 0** and emit no stdout — a stray non-zero or malformed JSON would mark the run failed and could stain the UI or block a tool.

### 3.3 Event mapping (ZCode → Petdex `EventKind`)

ZCode's 7 events map onto Petdex's 6 `EventKind`s as follows. Two ZCode events have no clean Petdex equivalent and are intentionally omitted.

| ZCode event | matcher | → `EventKind` | → `PetState` | Sprite row | Notes |
| --- | --- | --- | --- | --- | --- |
| `SessionStart` | `startup`/`resume` | `user.prompt` | `jumping` | 4 | signals "agent woke up" |
| `UserPromptSubmit` | — | `user.prompt` | `jumping` | 4 | user sent a prompt |
| `PreToolUse` | tool name | `tool.before` | `running` | 1/2 | agent working |
| `PostToolUse` | tool name | `tool.after` | `idle` | 0 | tool finished cleanly |
| `PostToolUseFailure` | tool name | `session.error` | `failed` | 5 | tool errored — **new, no Claude Code equivalent** |
| `PermissionRequest` | tool name | `session.waiting` | `waiting` | 6 | needs user input — replaces Claude Code's `Notification` |
| `Stop` | — | `session.end` | `waving` | 3 | turn finished |

**Important:** ZCode has **no `Notification` event**. The "waiting for user" state is best surfaced via `PermissionRequest`. This is the key behavioral difference from the Claude Code entry.

### 3.4 Exact changes required

#### A. Extend the registry (`packages/petdex-cli/src/hooks/agents.ts`)

1. **Extend the `id` union** at `agents.ts:65`:
   ```ts
   id: "claude-code" | "codex" | "gemini" | "opencode" | "antigravity" | "zcode";
   ```
   (Also update the `agentId: Agent["id"]` parameter of `bubbleHookCommand`/`curlOnlyState` — they already take `Agent["id"]`, so widening the union covers them, but scan for any exhaustiveness `switch` that the new literal would break.)

2. **Add an `AGENTS` entry** (after `antigravity`, ≈ line 561). The exact `configFile`/`slashCommandPath` are **pending the §3.2 resolution**; the values below are placeholders marked accordingly:
   ```ts
   {
     id: "zcode",
     displayName: "ZCode",
     // docsUrl: TODO — confirm the canonical ZCode hooks doc URL before shipping.
     //          "https://github.com/zai-org/zcode" is a guess; do not ship a guess.
     docsUrl: "https://zcode.z.ai/docs", // PLACEHOLDER — confirm
     // ⚠️ configDir/configFile unresolved — see §3.2. Prefer workspace config until
     // the user-scope path is confirmed. For detection, configDir must be a dir that
     // exists when ZCode is installed; `~/.zcode` exists on this machine, so detection
     // via configDir is safe regardless of which configFile we settle on.
     configDir: path.join(HOME, ".zcode"),
     configFile: path.join(HOME, ".zcode", "cli", "config.json"), // PENDING — may be ~/.zcode/v2/config.json
     // ⚠️ slashCommandPath unresolved: no ~/.zcode/commands or ~/.zcode/cli/commands
     // dir exists on this machine. Confirm the commands discovery path from the
     // zcode-guide skill (candidates: ~/.zcode/commands/petdex.md, ~/.agents/commands/petdex.md)
     // BEFORE wiring installSlashCommand, or skip the slash command for ZCode in v1.
     slashCommandPath: path.join(HOME, ".zcode", "commands", "petdex.md"), // PENDING
     hookEntries: [
       { event: "SessionStart",        kind: "user.prompt" },
       { event: "UserPromptSubmit",    kind: "user.prompt" },
       { event: "PreToolUse",          kind: "tool.before" },
       { event: "PostToolUse",         kind: "tool.after" },
       { event: "PostToolUseFailure",  kind: "session.error" },
       { event: "PermissionRequest",   kind: "session.waiting" },
       { event: "Stop",                kind: "session.end" },
     ],
     build() {
       // ZCode configuration-file hooks MUST use the `hooks.events.<Event>` nesting
       // (NOT the plugin `hooks.<Event>` form), and MUST set enabled:true.
       //
       // CROSS-PLATFORM HOOK SHAPE: bubbleHookCommand() emits POSIX shell
       // (`[ -f … ]`, `$HOME`) under `"type":"command"`, which ZCode runs through a
       // shell — that BREAKS on Windows (§3.6 #2). For the ZCode entry specifically
       // we therefore emit `"type":"process"` (argv, no shell) invoking the persisted
       // node binary directly. This requires a NEW helper (e.g. bubbleProcessHook)
       // that builds { command: <node abs path>, args: [<petdex.js>, "bubble", phase, "zcode"], timeoutMs }
       // and isPetdexEntry still detects it because the args contain "127.0.0.1:7777/state"
       // only if the node binary path does — so ALSO update isPetdexEntry (install.ts:336)
       // to recognize the process-form entry by matching the petdex.js path + "bubble"
       // arg, not only the :7777/state substring. See §3.4-D (detection) below.
       return {
         hooks: {
           enabled: true,   // CRITICAL — ZCode config-file hooks are off by default
           timeoutMs: 60000,
           events: {
             SessionStart:        [{ hooks: [bubbleProcessHook("zcode", "prompt",     "jumping",  800)] }],
             UserPromptSubmit:    [{ hooks: [bubbleProcessHook("zcode", "prompt",     "jumping",  800)] }],
             PreToolUse:          [{ hooks: [bubbleProcessHook("zcode", "pre",        "running")] }],
             PostToolUse:         [{ hooks: [bubbleProcessHook("zcode", "post",       "idle")] }],
             PostToolUseFailure:  [{ hooks: [bubbleProcessHook("zcode", "error",      "failed")] }],
             PermissionRequest:   [{ hooks: [bubbleProcessHook("zcode", "waiting",    "waiting")] }],
             Stop:                [{ hooks: [bubbleProcessHook("zcode", "stop",       "waving")] }],
           },
         },
       };
     },
   }
   ```
   `agent_source: "zcode"` (6 chars) flows through `curlOnlyState`/`bubble-runner`/the `agent_source` text column (`schema.ts:680`) unchanged.

#### B. Config-merge semantics — the default `mergeHooks` is WRONG for ZCode and MUST be overridden

`installForAgent`'s default JSON branch (`install.ts:249-270`) calls `mergeHooks` (install.ts:314), which does:
```ts
const patchHooks = (patch.hooks ?? {}) as Record<string, unknown[]>;
const existingHooks = (out.hooks ?? {}) as Record<string, unknown[]>;
const mergedHooks = { ...existingHooks };
for (const [event, entries] of Object.entries(patchHooks))
  mergedHooks[event] = [...filteredPrior, ...entries];
out.hooks = mergedHooks;
```
**This is keyed for Claude Code/Codex/Gemini, where `hooks` is a flat event map.** For ZCode, `hooks` is `{ enabled, timeoutMs, maxOutputBytes, events: {...} }`. The default merge would **flatten our nested `events` object onto `out.hooks` and drop `enabled`/`timeoutMs` semantics** — specifically, `mergedHooks.events` would replace the user's whole `events` map rather than merge per-event, and our `enabled: true` would overwrite but the user's `timeoutMs`/`maxOutputBytes` survive only by accident.

**This is a real bug if we reuse the default branch.** Add a dedicated branch in `installForAgent` (install.ts:212, mirroring the opencode/antigravity pattern) that merges correctly:
```ts
if (agent.id === "zcode") {
  // custom merge: preserve existing hooks.{enabled,timeoutMs,maxOutputBytes,events[*]}
  // and append our entries per-event inside hooks.events.<Event>.
  const base = existing.kind === "ok" ? (existing.value as Record<string, unknown>) : {};
  const patch = config as Record<string, unknown>;
  const patchHooks = (patch.hooks ?? {}) as Record<string, unknown>;
  const baseHooks = (base.hooks ?? {}) as Record<string, unknown>;
  const baseEvents = (baseHooks.events ?? {}) as Record<string, unknown[]>;
  const patchEvents = (patchHooks.events ?? {}) as Record<string, unknown[]>;
  const mergedEvents = { ...baseEvents };
  for (const [event, entries] of Object.entries(patchEvents)) {
    const prior = Array.isArray(mergedEvents[event]) ? mergedEvents[event] : [];
    const filteredPrior = prior.filter((e) => !isPetdexEntry(e)); // see §3.4-D
    mergedEvents[event] = [...filteredPrior, ...entries];
  }
  const merged = {
    ...base,
    hooks: {
      ...baseHooks,
      ...patchHooks,          // our enabled:true/timeoutMs win, but user's other keys kept
      events: mergedEvents,
    },
  };
  await writeFile(agent.configFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return { backupPath };
}
```
This is the most important code-level change in Workstream A — the plan previously said "verify, do not assume" but the default path is demonstrably wrong; treat overriding it as required, not optional.

#### C. Slash command

`installSlashCommand` writes a markdown body for all agents except gemini (TOML). **The ZCode command path is unconfirmed** (no `commands/` dir exists on this machine — see §3.2). Two safe options:
- **Skip the slash command for ZCode in v1** (gate it like antigravity: `agent.id !== "zcode"` in `shouldInstallSlashCommand`, install.ts:202). The killswitch is still reachable via `petdex hooks toggle`. Lowest risk.
- Or confirm the path (`~/.zcode/commands/petdex.md` is the documented candidate, with `~/.agents/commands/` as the cross-tool fallback) and ship markdown. If ZCode uses a different command format, add a branch like gemini's `GEMINI_COMMAND_BODY` in `slash-command.ts`.

Recommend the skip-until-confirmed option to avoid writing to an unverified path.

#### D. Detection (REQUIRED, not "no change")

`isPetdexEntry` (install.ts:336-343) recognizes our hooks by matching the substring `localhost:7777/state` OR the full `SIDECAR_URL` (`http://127.0.0.1:7777/state`) inside the entry's command strings. **If the ZCode entry uses `type: "process"` (required for Windows, §3.4-A), neither substring appears** — the args are `[<petdex.js>, "bubble", "prompt", "zcode"]`. So `isPetdexEntry` would **fail to recognize our own hooks**, and:
- `mergeHooks`' per-event de-dup wouldn't strip a stale prior install → duplicate entries accumulate on re-install.
- `stripPetdexHooks` (uninstall.ts) and `checkHooksInstalled` (doctor.ts) would silently miss them → uninstall appears to do nothing, doctor reports "not installed" while hooks are active.

**Fix:** extend `isPetdexEntry` to also match the persisted-binary path pattern. The cleanest signal is the literal `"bubble"` arg combined with a path ending in `petdex.js`/`petdex` under `.petdex/bin/`:
```ts
function isPetdexEntry(entry: unknown): boolean {
  const cmds = collectCommands(entry);
  return cmds.some((c) =>
    c.includes(`localhost:${PETDEX_PORT}/state`) ||
    c.includes(SIDECAR_URL) ||
    // process-form ZCode hook: argv invokes the persisted petdex bubble command
    /\.petdex[/\\]bin[/\\]petdex(\.js)?["']?\s.*\bbubble\b/.test(c),
  );
}
```
`collectCommands` already walks arrays/objects, so it picks up both the `command` (node path) and each `args[]` string of a process entry. Add a regression test that a synthetic process-form entry is detected.

#### E. Tests

Add a `describe("zcode", ...)` block to `packages/petdex-cli/src/hooks/agents.test.ts` pinning:
- `build()` output shape: 7 events under `hooks.events.*` (NOT `hooks.*` directly), `hooks.enabled === true`, and each hook is `type: "process"` with a `command` + `args` (no `shell`/`timeout` keys, which would silently drop the entry),
- `agent_source: "zcode"` appears in the bubble command args,
- the killswitch contract holds for the node bubble subcommand (mirrors the claude-code test at agents.test.ts:81-99 — the killswitch check happens *inside* the bubble subcommand, so assert the persisted binary honors `~/.petdex/runtime/hooks-disabled` by exiting 0),
- JSON round-trip safe,
- **`isPetdexEntry` returns true for the process-form entry** (the new detection path from §3.4-D),
- the custom merge (§3.4-B) preserves a synthetic user `hooks.timeoutMs`/`hooks.maxOutputBytes` and existing `hooks.events.Stop` entries while appending ours.

#### F. Doctor / uninstall

**Now require the §3.4-D detection change** — `checkHooksInstalled` (doctor.ts) and `stripPetdexHooks` (uninstall.ts) iterate `AGENTS` generically and call `isPetdexEntry`, so once that recognizes process-form entries they work unchanged. Without §3.4-D they would silently miss ZCode hooks; the prior draft's "no changes required" was incorrect.

### 3.5 What is NOT required

- No backend changes (`agent_source` is free-form text in the DB — verified at `schema.ts:680`).
- No sidecar changes (it accepts any string ≤64 chars for `agent_source`; `"zcode"` is 5 chars).
- No changes to `detectAgents`, `runInstall`, `runUninstall`, `runDoctor`, `runRefresh` (they iterate `AGENTS` generically).

### 3.5.1 What IS required (correcting the earlier "self-contained entry" framing)

- A **custom merge branch** in `installForAgent` (§3.4-B) — the default `mergeHooks` mishandles ZCode's nested `hooks.events` shape.
- A **new `bubbleProcessHook` helper** + an **`isPetdexEntry` update** (§3.4-A, §3.4-D) so Windows gets shell-free hooks and our own install/doctor/uninstall can still recognize them.
- A **decision on the slash command** (skip vs. confirm path).

### 3.6 Open questions for the maintainer

1. **Canonical config/command paths (BLOCKING for user-scope install).** The skill docs say `~/.zcode/cli/config.json`, but that file is absent on this Windows machine (the live config is `~/.zcode/v2/config.json`), and there is no `commands/` dir. Options: (a) confirm the real user-scope path against the installed ZCode version before shipping; (b) **ship workspace-scope only** (`<repo>/.zcode/config.json`), which is documented, version-controllable, and sidesteps the question. Recommend (b) for v1.
2. **Windows shell compatibility (RESOLVED → required).** The default `bubbleHookCommand` emits POSIX shell under `type:"command"`, which ZCode runs through a shell and which **breaks on Windows**. The ZCode entry MUST emit `type:"process"` (argv, no shell) invoking node + the persisted `petdex.js bubble` subcommand. This in turn requires the `isPetdexEntry` detection update (§3.4-D). This is no longer an open question — it's a required design decision, and it's the single most important correctness item in this workstream.

---

## 4. Workstream B — Windows 11 Desktop Integration

### 4.1 Goal

Ship a floating, transparent, click-through, always-on-top pet overlay on Windows 11, installable via `petdex init` / `petdex install desktop`.

### 4.2 Current state (better than expected)

Two parallel native shells exist:

| Package | Tech | Status |
| --- | --- | --- |
| `packages/petdex-desktop/` | Zig + WebKit (zero-native fork) | **Production, macOS-only.** `app.zon` declares `.platforms = .{ "macos" }`. |
| `packages/petdex-desktop-windows/` | **Tauri 2 (Rust) + WebView2** | **Scaffold, unreferenced.** Has pet scanner, sidecar spawner, CSS sprite renderer. Binary name `petdex-desktop-win32-x64` (matches CLI's expected asset). |

The **cross-platform layer is already done**: the Node.js sidecar (`sidecar/server.ts`), the `~/.petdex/runtime/*.json` file IPC, the sprite CSS/JS, and the CLI's Windows install/process/update/select plumbing (`tasklist`, `taskkill /t /f`, `.exe` suffix, `win32-x64` asset detection).

### 4.3 Recommended approach: finish the Tauri scaffold

The Tauri scaffold is the lower-effort path. Writing a third native shell from scratch (extending the Zig `zero-native` fork with a Windows WebView2 COM module) would duplicate work that the scaffold already does. **Recommendation: adopt `packages/petdex-desktop-windows/` as the Windows shell.**

Window flags already map cleanly in `src-tauri/tauri.conf.json`:

| macOS (Zig) | Windows (Tauri) | Effect |
| --- | --- | --- |
| `frameless: true` | `decorations: false` | borderless |
| `transparent: true` | `transparent: true` | see-through background |
| `always_on_top: true` | `alwaysOnTop: true` | floats above windows |
| `LSUIElement: true` | `skipTaskbar: true` + `focus: false` | no taskbar icon, no focus steal |

### 4.4 Win32 transparency & click-through (the hard part)

This is the single biggest technical risk. The scaffold already sets `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `focus: false` in `tauri.conf.json`, but on Windows **`transparent: true` alone is necessary, not sufficient** — Tauri/WebView2 transparent windows need the WebView2 background set to a transparent brush AND, for clean per-pixel sprite edges (anti-aliased outlines, not hard color-key fringes), the Win32 window must be a layered window using `UpdateLayeredWindow` with a 32-bit ARGB DIB. Plan to verify the scaffold's current transparency quality early: render a test sprite with a curved anti-aliased edge on a transparent window and check for halos/color fringes against a busy desktop background before assuming the default works.

Three required behaviors and how to achieve them on Win32:

1. **Always-on-top** — `SetWindowPos(hwnd, HWND_TOPMOST, …, SWP_NOACTIVATE)` or Tauri's `alwaysOnTop`. ✅ Easy.
2. **Transparency** — requires `WS_EX_LAYERED`. Two APIs:
   - `SetLayeredWindowAttributes` — uniform opacity or a single color key. Cheap, but hard edges (no anti-aliased sprite outline).
   - `UpdateLayeredWindow` — true per-pixel alpha via a 32-bit ARGB DIB. **Required for clean sprite edges.**
3. **Click-through** — the subtle part:
   - `WS_EX_TRANSPARENT` makes the **entire** window click-through (too blunt if the pet should be grabbable).
   - With `UpdateLayeredWindow`, pixels where **alpha = 0 are automatically click-through** — per-pixel control. This is the correct approach.
   - **Known WebView2 quirk (WebView2Feedback #1004):** a fully transparent WebView2 page tends to pass ALL clicks through regardless of opaque HTML. The [Faksimile/WebView2-Click-Through](https://github.com/Faksimile/WebView2-Click-Through) demo shows the fix: a JS bridge that toggles Win32 hit-testing dynamically so transparent areas pass clicks while HTML controls (right-click menu, drag handle) stay clickable.

**Action item:** add a small Rust crate/Tauri plugin in the Windows package that calls `SetWindowLongPtrW` + `UpdateLayeredWindow` on the HWND, and exposes a `set_click_through(bool)` Tauri command driven by a JS bridge (mirroring the Faksimile pattern).

### 4.5 Feature gaps in the scaffold (port from `main.zig`)

The Zig macOS app (`packages/petdex-desktop/src/main.zig`, ~3725 lines) has features the Tauri scaffold lacks. Port these into Rust + the `ui/index.html`:

| Feature | macOS location | Windows work |
| --- | --- | --- |
| Momentum/throw drag physics | `main.zig:998-1077` | port to JS in `ui/index.html` (Tauri `startDragging` exists but has no physics) |
| Pet picker (expand window to 480×420) | `main.zig:1092-1095` (`zero-native.window.resize`) | Tauri `set-size` + `set-position` |
| Settings window | bridge `write_desktop_settings` | new Tauri window or inline panel |
| Bubble text rendering | `main.zig:554-612` (polls `bubble.json`) | port the polling + render to `ui/index.html` |
| Deep links (`petdex://`) | `main.zig:3189` (reads `incoming-url.txt` from AppleEvents) | registry-based scheme: `HKCR\petdex\shell\open\command` |
| Update card | sidecar `GET /update` | port the card to `ui/index.html`; self-update deferred to CLI `petdex update` |
| Sidecar watchdog respawn | `server.ts:1508-1522` | already handled in sidecar (cross-platform) |

### 4.6 Platform-assumption fixes in the CLI

`packages/petdex-cli/src/desktop/doctor.ts` has latent Windows bugs found during investigation:

| Location | Bug | Fix |
| --- | --- | --- |
| `doctor.ts:32` | `homeDir()` uses `process.env.HOME ?? homedir()` — no `USERPROFILE` fallback on Windows | add `?? process.env.USERPROFILE` (the `install.ts` `homeDir` already does this correctly — reuse it) |
| `doctor.ts:54-62` | `stat.mode & 0o111` exec-bit check — **meaningless on Windows** | skip on `win32` |
| `doctor.ts:204-212` | `chmod 600` token check — no-op on Windows | skip on `win32` |
| `doctor.ts:455` | `lsof -nP -iTCP:7777` — not available on Windows | branch to `netstat -ano | findstr :7777` or PowerShell `Get-NetTCPConnection` |

The rest of the CLI desktop layer (`install.ts`, `process.ts`, `update.ts`, `select.ts`) is already Windows-aware (verified against `process.win32.test.ts`).

### 4.7 Node discovery on Windows

The sidecar is spawned as `node server.js`. On Windows, `node` may not be on `PATH` in all contexts (a GUI app does not inherit a shell's PATH). The Tauri `find_node()` (lib.rs:125-147) currently checks **only**: `where.exe node`, `C:\Program Files\nodejs\node.exe`, `C:\Program Files (x86)\nodejs\node.exe` — it does **NOT** search nvm/scoop/fnm/volta as the earlier draft claimed (that list was inaccurate). So a user with node installed only via nvm-windows, scoop, or fnm would get the bare `"node"` fallback and the sidecar spawn would fail.

**Fix `find_node()` to cover the common Windows managers** (verify each path on a clean install):
- nvm-windows: `%NVM_SYMLINK%\node.exe` (usually `C:\Program Files\nodejs` via symlink — already covered) and `%NVM_HOME%`
- scoop: `%USERPROFILE%\scoop\shims\node.exe`
- fnm: `%USERPROFILE%\AppData\Local\fnm_multishells\...` (resolvable via `fnm env`)
- volta: `%USERPROFILE%\.volta\bin\node.exe`
- `%APPDATA%\nvm\...`, `%LOCALAPPDATA%\fnm\...`

**Stronger alternative:** eliminate the Node dependency entirely by building the sidecar with `bun build --target=bun --compile` to a standalone `.exe`, OR bundle a known-good Node runtime alongside the binary. The sidecar's `sidecar/package.json` currently uses `bun build --target=node --format=cjs`, so it expects a host Node today — changing `--target` is a one-line build change but shifts the runtime expectation. Recommend: expand `find_node()` for v1 (lowest risk), evaluate Bun-compile for a follow-up.

### 4.8 Release pipeline

Today `scripts/release-desktop.ts` + `scripts/build-release.sh` produce only macOS artifacts (`Petdex-arm64.dmg`, `Petdex-x64.dmg`, bare `petdex-desktop-darwin-*` binaries, and `petdex-desktop-sidecar.js`). The CLI's `install.ts` already knows to look for `petdex-desktop-win32-x64`.

**Add a Windows release path:**
1. A `build-release-windows` step: `cargo build --release` in `packages/petdex-desktop-windows/src-tauri`, producing `petdex-desktop-win32-x64.exe`.
2. Code-signing with `signtool` (optional; no notarization needed on Windows, unlike macOS).
3. Extend `release-desktop.ts`'s `verifyArtifacts` (line 296-330) to also expect `petdex-desktop-win32-x64`.
4. Upload the Windows binary as a release asset alongside the macOS ones. **The CLI install path then works unchanged.**

Consider an MSI/NSIS installer for UX (Start Menu shortcut, uninstaller), but the bare `.exe` to `~/.petdex/bin/` is the minimum viable path and matches the existing CLI contract.

### 4.9 Self-update strategy

The macOS sidecar self-updates via DMG (`applyBundledUpdate`, `server.ts:804-944`, throws on non-darwin). **Recommendation: do NOT port the in-app self-updater to Windows initially.** The sidecar already surfaces *"Run petdex update in your terminal"* when `canInstallBundledUpdate()` returns false (`server.ts:406-410`), and the CLI's `petdex update` (`update.ts:384-401`) already handles the Windows bare-binary swap with file-lock handling. Defer in-app update until after launch.

---

## 5. Workstream C — In-App Pet Generation (hatch-pet replication)

### 5.1 Goal

Replicate the `hatch-pet` skill's pet generation inside the Windows desktop integration, using `gpt-image-2` via OpenRouter (with the user's API key), so users can create pets without Codex.

### 5.2 What hatch-pet actually does (the authoritative workflow)

Source: `openai/skills` repo, `skills/.curated/hatch-pet/` (SKILL.md fully retrieved, 499 lines). The skill **delegates all image generation** to a system skill `$imagegen`; it does **not** call the Image API directly. The workflow:

| Phase | What happens | Script |
| --- | --- | --- |
| 0 | (Optional) brand discovery subagent writes a brief | — |
| 1 | Prepare run folder: `pet_request.json`, job manifest, 9 row-specific layout-guide images | `prepare_pet_run.py` |
| 2 | **Generate ~10 images**: 1 base (full-body pet on chroma bg) + 9 row strips (one per state). Each strip is a horizontal sequence of N frames for one state. Identity lock: every row job re-attaches the canonical base. | `$imagegen` worker subagents |
| 3 | Parent copies selected outputs into `decoded/` | — |
| 4 | (Optional) derive `running-left` from `running-right` by per-frame mirroring | `derive_running_left_from_running_right.py` |
| 5 | **Deterministic image pipeline**: extract frames → inspect → compose atlas → validate → contact sheet → preview GIFs | `extract_strip_frames.py`, `inspect_frames.py`, `compose_atlas.py`, `validate_atlas.py`, `make_contact_sheet.py`, `render_animation_previews.py` |
| 6 | Visual QA worker reviews contact sheet + GIFs | — |
| 7 | Repair failing rows (regenerate smallest scope) | — |
| 8 | Package: write `spritesheet.webp` + `pet.json` to `~/.codex/pets/<id>/` | shell + `jq` |

### 5.3 The pet contract (immutable target)

- **Atlas:** `1536 × 1872` px, **8 columns × 9 rows**, cells `192 × 208` px, transparent background (unused cells fully transparent).
- **`pet.json`** (4 fields):
  ```json
  { "id": "pet-name", "displayName": "Pet Name", "description": "One short sentence.", "spritesheetPath": "spritesheet.webp" }
  ```
- **Animation rows** (fixed mapping):

  | Row | State | Columns used | Per-frame durations (ms) |
  | --- | --- | --- | --- |
  | 0 | `idle` | 0-5 | 280, 110, 110, 140, 140, 320 |
  | 1 | `running-right` | 0-7 | 120 ×7, 220 |
  | 2 | `running-left` | 0-7 | 120 ×7, 220 |
  | 3 | `waving` | 0-3 | 140 ×3, 280 |
  | 4 | `jumping` | 0-4 | 140 ×4, 280 |
  | 5 | `failed` | 0-7 | 140 ×7, 240 |
  | 6 | `waiting` | 0-5 | 150 ×5, 260 |
  | 7 | `running` | 0-5 | 120 ×5, 220 |
  | 8 | `review` | 0-5 | 150 ×5, 280 |

  Note: `running` (row 7) is "active task work" (thinking/typing), NOT locomotion. The 8x11 variant (`spriteVersionNumber 2`, `1536×2288`) adds 2 rows of "look directions" and is accepted by petdex's validator (`submissions-validation.ts:74-92`; the `isClassicGrid`/`isV2Grid` ratio checks at lines 80-83) but is **not** required — target the 8×9 classic grid first.

**Output path (corrected):** write generated pets to `~/.petdex/pets/<id>/` (spritesheet.webp + pet.json). This is the **primary** pet root for both the macOS Zig shell and the Windows Tauri shell (`pet_roots()` in `petdex-desktop-windows/src-tauri/src/lib.rs:41-48` lists `~/.petdex/pets` first, `~/.codex/pets` as a legacy fallback). The earlier draft's "~/.codex/pets/<id>/" was the legacy Codex location; petdex's own root is `.petdex`. The `STATE_MAP` in `agents.ts:34-41` maps `EventKind`→`PetState` and lines up with these rows (`tool.before`→`running` row 7, `session.end`→`waving` row 3, etc.), so the atlas row order must match that enum exactly.

### 5.4 Feasibility verdict

**Feasible, with one hard constraint.** The workflow is deterministic and fully documented. The 7 Python scripts have exact CLI signatures and can be reimplemented in TypeScript (the project already uses `sharp` for image manipulation — see `submission-review.ts:1245` for an existing dHash-with-sharp pattern).

**The hard constraint: `gpt-image-2` has no native transparency, and it is the only allowed model.** Authoritatively confirmed via the live endpoint detail (see §2.5): `background` is `["auto", "opaque"]` only, with no `transparent` option. Per the maintainer's requirement there is **no fallback** to `gpt-image-1`/`gpt-image-1-mini`. There is therefore exactly one viable design:

| Decision | Resolution |
| --- | --- |
| **Model** | `openai/gpt-image-2` only — mandatory, non-negotiable. |
| **Transparency** | Port `hatch-pet`'s chroma-key pipeline (generate on flat chroma bg, key out in post). This is now a **release blocker**, not a Phase 2 toggle. |
| **Identity lock** | `input_references` (0–16, confirmed supported on gpt-image-2) — pass the canonical base as a reference on every row strip. |

**Implication for scope/sequencing:** the chroma-key port (`extract-strip-frames.ts`, `validate-atlas.ts` transparency invariant) moves from "Phase 6 opt-in" to **on the critical path** — no working pets ship without it. Update the Build Order (§7) accordingly. The C-1/C-1b/C-3 fallback options from the earlier draft are removed entirely.

### 5.5 OpenRouter API specifics (verified against the OpenAPI spec)

The generation endpoint is **`POST https://openrouter.ai/api/v1/images`** (OpenAPI path `/images`, server `https://openrouter.ai/api/v1`, operationId `createImages`). This is **not** OpenAI's `/v1/images/generations` path — a common mistake. The model-discovery endpoint is the separate `GET /api/v1/images/models` (and per-model `GET /api/v1/images/models/<slug>/endpoints` for provider-level parameter subsets).

Authoritative sources (retrieved 2026-07-14):
- OpenAPI YAML at `https://openrouter.ai/docs/api/api-reference/images/generate-an-image.md` → `paths./images.post`.
- Live model list `GET /api/v1/images/models` confirms `openai/gpt-image-2`, `openai/gpt-image-1`, `openai/gpt-image-1-mini` and their `background` enums (see §2.5).

Request shape (top-level fields, per `ImageGenerationRequest` schema):

```bash
curl -X POST "https://openrouter.ai/api/v1/images" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-image-2",
    "prompt": "...flat solid chroma-key background (e.g. #00FF00), full-body pet, no shadow on ground...",
    "quality": "high",
    "background": "opaque",
    "output_format": "png",
    "input_references": [{ "image_url": "data:image/png;base64,..." }]
  }'
```

Notes from the spec:
- `background` is a **top-level** field. On gpt-image-2 it must be `"opaque"` (the only non-`auto` value) — the transparency comes from the chroma-key post-step, never from the model.
- `input_references` (0–16 images, each an object with an `image_url` that may be a data URL) is **how the identity lock works**: every row strip generation passes the canonical base as a reference. Confirmed supported on gpt-image-2 (§2.5).
- Response: `{ "created": <unix>, "data": [{ "b64_json": "..." }], "usage": { "cost": 0.04, "total_tokens": ..., "completion_tokens": ... } }`. Note the response `data[].b64_json` does **not** carry a `media_type` field in the schema — infer type from the requested `output_format`.
- The endpoint also supports `text/event-stream` (SSE, `supports_streaming: true` on gpt-image-2) with `image_generation.partial_image` events. **Do not enable streaming** — it complicates the deterministic pipeline and the chroma-key post-step needs the final frame anyway.
- The prompt MUST instruct the model to render on a specific flat chroma color and avoid gradients/shadows on the background, or the chroma key will leak fringe pixels. This prompt discipline is part of the contract, not an optimization.

### 5.6 Architecture for in-app generation

This is a new feature surface. Proposed layout (to confirm with maintainer):

```
packages/petdex-desktop-windows/
└── generation/                      # NEW — TypeScript reimplementation of hatch-pet
    ├── prepare-run.ts               # ← prepare_pet_run.py
    ├── imagegen.ts                  # ← replaces $imagegen; talks to OpenRouter
    ├── extract-strip-frames.ts      # ← extract_strip_frames.py (sharp)
    ├── inspect-frames.ts            # ← inspect_frames.py
    ├── compose-atlas.ts             # ← compose_atlas.py (sharp)
    ├── validate-atlas.ts            # ← validate_atlas.py (transparency invariant)
    ├── make-contact-sheet.ts        # ← make_contact_sheet.py
    ├── render-previews.ts           # ← render_animation_previews.py (gifenc is a dep)
    ├── derive-running-left.ts       # ← derive_running_left...py
    ├── pet-contract.ts              # the 8x9 grid + row/frame/duration table above
    └── prompts.ts                   # per-state prompt templates + identity-lock rules
```

The existing dependency `sharp` (`^0.34.5`, already in root `package.json`) covers all image manipulation. `gifenc` (`^1.0.3`, already a dep) covers preview GIFs. **No new dependencies are strictly required.**

### 5.7 Where the API key lives (security model — expanded)

The OpenRouter key must **never** be sent to the petdex backend (it's a user secret that can spend real money). Two host options:

- **Desktop sidecar (recommended):** store the key locally, call OpenRouter from the sidecar. Add a new sidecar endpoint `POST /generate`. The web backend never sees the key.
- **CLI-side:** `petdex generate <description>` reads the key from env/keychain, runs the pipeline, writes to `~/.petdex/pets/<id>/` (note: the Tauri `pet_roots()` in lib.rs:41 already reads `~/.petdex/pets`, so write there, not `~/.codex/pets/` as the earlier draft said — `~/.codex/pets/` is a legacy fallback root, not the primary).

Either way, generation is **local-only**; the resulting pet is then submitted through the normal `petdex submit` flow if the user wants to publish it.

**Security requirements the earlier draft omitted (must implement, not optional):**

1. **Key at rest.** `desktop-settings.json` is plain JSON in the user's home dir. On Windows, prefer `DPAPI` (`CryptProtectData`) via the Node `win-dpapi` pattern or a small Rust command in the Tauri shell, so the key isn't readable by another local process running as a different user. If DPAPI is out of scope for v1, at minimum `chmod`/`icacls` the file to owner-only and document the plaintext trade-off explicitly in the settings UI. Never log the key; never include it in error messages or telemetry.
2. **Authenticate the new `POST /generate` endpoint.** It spends money, so it is a state-changing endpoint and **must** be gated by the existing `X-Petdex-Update-Token` (per the AGENTS.md invariant: "State-changing browser endpoints should use `requireSameOrigin`"). Additionally bind it to `127.0.0.1`-only (the sidecar already binds loopback) and validate the request body strictly. Without this, any web page the user visits could POST to `localhost:7777/generate` and burn the user's OpenRouter credits (drive-by cost attack).
3. **Cost guardrail before generation.** Surface an estimate (images × per-image cost from the model's pricing) and require explicit confirmation in the UI before the first call. The risk register lists "cost runaway" as Medium; the estimate-then-confirm gate is the concrete mitigation. Cap retries per row (default 1) and total images per run.
4. **Prompt sanitization.** The user-supplied pet description flows into the image prompt. Keep it out of any system/tool-instruction position and cap its length, mirroring `auto-tag.ts:101-122`. This is already in the risk register but the implementation must enforce it at the boundary, not rely on the model.
5. **Output validation before write.** Reject any generated asset that fails the atlas-grid check (`submissions-validation.ts:74-92`) and the transparency-invariant check (§5.8) before writing to `~/.petdex/pets/`. A malformed local pet would crash the Tauri renderer on next load (lib.rs `MAX_PET_BYTES` only guards size, not validity).

### 5.8 Validation invariant to enforce

`validate_atlas.py` enforces a transparency invariant: transparent pixels must not retain RGB residue (otherwise compositing produces halos). When porting to `validate-atlas.ts`, use `sharp` to scan for pixels where `alpha < threshold` but `R|G|B ≠ 0` and fail the build. This is the single most important quality gate.

### 5.9 Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| gpt-image-2 opacity only (no `transparent`) | **Certain** (verified via live endpoint) | **Mandatory model — no fallback.** Port the chroma-key pipeline (generate on flat chroma bg, key out in post); enforce strict chroma-bg prompt discipline to avoid fringe pixels |
| Identity drift across rows (pet looks different per state) | High | Enforce identity lock: pass canonical base as `input_references` on every row job (the hatch-pet approach) |
| Cost runaway (10 images/pet × $$) | Medium | Surface estimated cost before generation; cap at 1 retry per row |
| Frame misalignment in strips | Medium | Port `extract-strip-frames.ts` with the `stable-slots` method for QA correction |
| Prompt injection from user description | Low | Sanitize description; keep it out of system prompt (petdex already does this in `auto-tag.ts:101-122`) |
| OpenRouter rate limits | Low | Add exponential backoff; the existing `@upstash/ratelimit` pattern is a model |

---

## 6. Cross-Workstream Decisions To Confirm

These are decisions only the maintainer can make; they change scope. Items marked **[audit: resolved]** were investigated during the 2026-07-14 audit and now have a recommended default rather than an open question.

1. **ZCode config paths** — confirm the user-scope path (`~/.zcode/cli/config.json` per docs, but `~/.zcode/v2/config.json` on this machine) and whether a `commands/` dir exists. **[audit: recommend shipping workspace-scope (`<repo>/.zcode/config.json`) for v1 to sidestep the unresolved user-scope path — see §3.2.]**
2. **Windows shell portability** — should the ZCode agent emit `"type": "process"`? **[audit: resolved → REQUIRED.** POSIX `command` hooks break on Windows; `type:"process"` is mandatory, and it forces the `isPetdexEntry` detection update in §3.4-D. No longer optional.]**
3. **Native shell choice** — adopt the existing Tauri scaffold (recommended) vs. extend the Zig `zero-native` fork with a Windows WebView2 module? Recommend Tauri.
4. **Model choice** — **[audit: RESOLVED by maintainer.** `openai/gpt-image-2` is the **only** allowed model; no fallback to gpt-image-1/-mini. Confirmed via live `/api/v1/images/models/openai/gpt-image-2/endpoints` that its `background` enum is `["auto","opaque"]` (no `transparent`) but `input_references` 0–16 IS supported. **Consequence: the chroma-key pipeline is mandatory and on the critical path** — see §2.5, §5.4, §7.]**
5. **Where generation runs** — desktop sidecar (recommended, key stays local, but see the new §5.7 security requirements: DPAPI at rest, token-gate `POST /generate`, cost guardrail) vs. CLI command vs. new web route (not recommended; key handling risk)?
6. **Installer packaging** — bare `.exe` to `~/.petdex/bin/` (minimum viable, matches existing CLI contract) vs. MSI/NSIS installer (better UX)?
7. **Node discovery on Windows (new)** — **[audit: `find_node()` in the scaffold only checks 2 Program Files paths + `where`, missing nvm/scoop/fnm/volta (§4.7).]** Fix `find_node()` for v1; evaluate Bun-compile of the sidecar to drop the Node dependency entirely.

---

## 7. Suggested Build Order

Sequenced for fastest feedback and lowest risk first.

| Phase | Workstream | Deliverable | Why first |
| --- | --- | --- | --- |
| **1** | A | ZCode agent entry + tests | Smallest, most localized; immediately useful; validates the registry extension pattern |
| **2** | B (core) | Finish Tauri scaffold transparency/click-through + wire release asset | Unblocks `petdex init` on Windows; scaffold already exists |
| **3** | B (polish) | Port picker, drag physics, bubbles, deep-links from `main.zig` | Feature parity with macOS |
| **4** | B (CLI fixes) | `doctor.ts` Windows bugs (`HOME`→`USERPROFILE`, exec-bit, `lsof`→`netstat`) | Correctness on Windows |
| **5** | C (critical path) | **Port the chroma-key pipeline first** (`extract-strip-frames.ts`, `validate-atlas.ts` transparency invariant, `compose-atlas.ts`) | gpt-image-2 cannot emit alpha, so nothing else in C works until this exists |
| **6** | C (generation) | Wire gpt-image-2 generation (identity lock via `input_references`) + the rest of the hatch-pet pipeline | Produces finished pets; depends on Phase 5 |

Phases 1-2 are independently shippable. **Phase 5 is now a prerequisite for Phase 6** (was previously parallelizable when gpt-image-1 was an option) — the chroma-key port is on the critical path because gpt-image-2 is mandatory and has no native transparency.

---

## 8. Research Sources

### hatch-pet skill
- [openai/skills — hatch-pet directory](https://github.com/openai/skills/tree/main/skills/.curated/hatch-pet)
- [hatch-pet SKILL.md (raw)](https://raw.githubusercontent.com/openai/skills/main/skills/.curated/hatch-pet/SKILL.md)
- [How to use Codex pets (augmentedswe.com)](https://www.augmentedswe.com/p/how-to-use-codex-pets)

### OpenRouter / gpt-image-2
- [OpenRouter: GPT Image 2 model page](https://openrouter.ai/openai/gpt-image-2)
- [OpenRouter Image Generation docs](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [OpenRouter Image Models API reference](https://openrouter.ai/docs/api/api-reference/images/list-image-generation-models)
- [OpenRouter Generate-an-image OpenAPI reference](https://openrouter.ai/docs/api/api-reference/images/generate-an-image) — authoritative for the `POST /api/v1/images` path and the `ImageGenerationRequest` schema
- Live `GET https://openrouter.ai/api/v1/images/models` response (retrieved 2026-07-14, unauthenticated) — authoritative source for the per-model `background` enums in §2.5
- [gpt-image-2 transparency workaround (Reddit)](https://www.reddit.com/r/EntrepreneurRideAlong/comments/1stt5ok/added_gptimage2_support_had_to_build_transparency/)

### Windows overlay / WebView2
- [Faksimile/WebView2-Click-Through (demo of dynamic hit-testing)](https://github.com/Faksimile/WebView2-Click-Through)
- [WebView2Feedback #1004 — transparency & click-through](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1004)
- [Tauri issue #13070 — click-through feature request](https://github.com/tauri-apps/issues/13070)
- [Tauri v2 Window Customization docs](https://v2.tauri.app/learn/window-customization/)
- [webview/webview (cross-platform C webview lib)](https://github.com/webview/webview)
- [SO: pass clicks through a transparent always-on-top window](https://stackoverflow.com/questions/39855720/windows-forms-pass-clicks-through-a-partially-transparent-always-on-top-window)

### ZCode hooks
- `C:\Users\predator\.zcode\cli\plugins\cache\zcode-plugins-official\zcode-guide\0.1.0\skills\diagnosing-hooks\SKILL.md` (authoritative — 7 events, schema, pitfalls)
- `C:\Users\predator\.zcode\cli\plugins\cache\zcode-plugins-official\zcode-guide\0.1.0\skills\zcode-configuration-guide\SKILL.md` (config paths/precedence — note the on-disk discrepancy flagged in §3.2)

### Codebase references (internal)
- `packages/petdex-cli/src/hooks/agents.ts` — agent registry (the extension point)
- `packages/petdex-cli/src/hooks/install.ts` / `uninstall.ts` — generic install/uninstall (no change needed)
- `packages/petdex-desktop/src/main.zig` — macOS native app (port source for Windows features)
- `packages/petdex-desktop/sidecar/server.ts` — cross-platform sidecar (Windows-compatible except self-updater)
- `packages/petdex-desktop-windows/` — existing Tauri scaffold (the Windows shell to finish)
- `packages/petdex-cli/src/desktop/install.ts` / `process.ts` / `doctor.ts` — CLI desktop layer (doctor has Windows bugs)
- `src/lib/submissions-validation.ts:80-92` — atlas grid validation (8x9 / 8x11)
- `src/lib/db/schema.ts:680` — `agent_source` is free-form text (no backend migration for ZCode)
