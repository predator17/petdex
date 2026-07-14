# Implementation Plan: ZCode Support, Windows Desktop, and In-App Pet Generation

> **Status:** Planning document only. No source edits have been made.
> **Scope of investigation:** CLI hooks system, desktop native app + sidecar, `openai/skills` `hatch-pet` skill, OpenRouter image API, ZCode hook format, Windows 11 overlay window options.
> **Date:** 2026-07-14

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

Verified against OpenRouter's live endpoint: `openai/gpt-image-2` accepts `background: ["auto", "opaque"]` only — **no `transparent`**. By contrast, `openai/gpt-image-1` supports `background: ["auto", "transparent", "opaque"]`.

The `hatch-pet` skill works around exactly this by generating on a flat chroma-key background and then deterministically keying it out with its Python scripts (`extract_strip_frames.py`, `validate_atlas.py`). So `gpt-image-2` **is** usable — but only if we port the chroma-key removal pipeline, not if we expect native alpha. This is a core design constraint for Workstream C.

### 2.6 ZCode's hook events differ from Claude Code's

ZCode supports **exactly 7 events**: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Stop`.

It **does not** support `Notification` or `SubagentStop` (which the Claude Code entry uses), and it **adds** `PermissionRequest` and `PostToolUseFailure`. Configuration-file hooks are **disabled by default** and must be enabled with `"hooks": { "enabled": true }`. Matcher is a **case-sensitive regex** (so `"bash"` will not match `Bash`).

---

## 3. Workstream A — Full ZCode Agent Support

### 3.1 Goal

Add `zcode` as a sixth supported agent in `petdex init` / `petdex hooks install`, so the desktop floater reacts to ZCode activity the same way it does for Claude Code or Codex.

### 3.2 Ground truth: ZCode's hook format

Investigated from the authoritative `zcode-guide` skills installed locally (`C:\Users\predator\.zcode\cli\plugins\cache\zcode-plugins-offical\zcode-guide\...`).

**Config locations (in priority order):**
1. User: `~/.zcode/cli/config.json` (this machine's file currently has no `hooks` key)
2. Workspace: `<repo>/.zcode/config.json` (petdex has no `.zcode/` dir today)
3. UI prefs (not for hooks): `~/.zcode/v2/setting.json`

**Schema:**
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

**Entry types:**
- `"type": "command"` — `command` is a shell string. **POSIX shell syntax fails on Windows**, so for cross-platform hooks prefer `"type": "process"`.
- `"type": "process"` — `command` (executable) + `args[]` (argv, no shell). Most portable; recommended for the Windows path.

**Template variables** (expanded in `command`/`args`, also injected as env vars): `${ZCODE_PROJECT_DIR}` (also `${CLAUDE_PROJECT_DIR}`), `${CLAUDE_SESSION_ID}`.

**Output contract:** stdout parsed as JSON (strict), or exit codes: `0` = pass, `2` = block/deny, other non-zero = error.

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

2. **Add an `AGENTS` entry** (after `antigravity`, ≈ line 561):
   ```ts
   {
     id: "zcode",
     displayName: "ZCode",
     docsUrl: "https://github.com/zai-org/zcode",  // confirm canonical URL
     configDir: resolveHome("~/.zcode"),             // detection target
     configFile: resolveHome("~/.zcode/cli/config.json"),
     slashCommandPath: resolveHome("~/.zcode/cli/commands/petdex.md"), // confirm location
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
       // Same shape as claude-code/codex/gemini, using bubbleHookCommand.
       return {
         hooks: {
           enabled: true,   // CRITICAL — ZCode config-file hooks are off by default
           events: {
             SessionStart:        [{ hooks: [{ type: "command", command: bubbleHookCommand("zcode", "prompt", "jumping", 800) }] }],
             UserPromptSubmit:    [{ hooks: [{ type: "command", command: bubbleHookCommand("zcode", "prompt", "jumping", 800) }] }],
             PreToolUse:          [{ hooks: [{ type: "command", command: bubbleHookCommand("zcode", "pre", "running") }] }],
             PostToolUse:         [{ hooks: [{ type: "command", command: bubbleHookCommand("zcode", "post", "idle") }] }],
             PostToolUseFailure:  [{ hooks: [{ type: "command", command: bubbleHookCommand("zcode", "error", "failed") }] }],
             PermissionRequest:   [{ hooks: [{ type: "command", command: bubbleHookCommand("zcode", "waiting", "waiting") }] }],
             Stop:                [{ hooks: [{ type: "command", command: bubbleHookCommand("zcode", "stop", "waving") }] }],
           },
         },
       };
     },
   }
   ```
   The `bubbleHookCommand` helper already embeds `:7777/state`, so install/uninstall/doctor detection works automatically. `agent_source: "zcode"` flows through `curlOnlyState`/`bubble-runner` unchanged.

#### B. Config-merge semantics — verify, do not assume

`installForAgent`'s default JSON branch (`install.ts:249`) does a shallow top-level merge and a per-event append under `.hooks`. **Risk:** ZCode's `config.json` may have other top-level keys (`provider`, `mcpServers`, etc.) that must be preserved. The existing `mergeHooks` preserves non-`hooks` keys, so this should be safe — **but verify** against a real `~/.zcode/cli/config.json` before shipping, because the ZCode schema nests `enabled`/`timeoutMs` *inside* `hooks` (unlike Claude Code where `hooks` is purely the event map). The merge must keep a user's existing `hooks.enabled`/`hooks.timeoutMs` and only append into `hooks.events.<Event>`.

**If the default merge is insufficient**, add a dedicated branch in `installForAgent` (`install.ts:212`) mirroring the opencode/antigravity pattern:
```ts
if (agent.id === "zcode") {
  // custom merge preserving hooks.enabled / hooks.timeoutMs / hooks.maxOutputBytes
  return { backupPath };
}
```

#### C. Slash command

`installSlashCommand` writes a markdown body for all agents except gemini (TOML). **Confirm** whether ZCode reads commands from `~/.zcode/cli/commands/petdex.md` or a different path/format. If markdown is fine, no change needed. If ZCode uses a different command format, add a branch like gemini's `GEMINI_COMMAND_BODY` in `slash-command.ts`.

#### D. Tests

Add a `describe("zcode", ...)` block to `packages/petdex-cli/src/hooks/agents.test.ts` pinning:
- `build()` output shape (7 events, `hooks.enabled === true`),
- `agent_source: "zcode"` appears in the curl fallback,
- killswitch is the FIRST statement and exits 0 (mirrors the claude-code test at L81-91),
- JSON round-trip safe,
- the generated command contains `127.0.0.1:7777/state` (so `isPetdexEntry` detects it).

#### E. Doctor / uninstall

No changes required — `checkHooksInstalled` (`doctor.ts:235`) and `stripPetdexHooks` (`uninstall.ts:242`) iterate `AGENTS` generically and key off the `:7777/state` substring.

### 3.5 What is NOT required

- No backend changes (`agent_source` is free-form text in the DB).
- No sidecar changes (it accepts any string ≤64 chars for `agent_source`).
- No changes to `detectAgents`, `runInstall`, `runUninstall`, `runDoctor`, `runRefresh`.

### 3.6 Open questions for the maintainer

1. **Canonical config/command paths** — confirm `~/.zcode/cli/config.json` and `~/.zcode/cli/commands/` are stable (these were read from the local install; verify against ZCode docs).
2. **Windows shell compatibility** — the default `bubbleHookCommand` emits POSIX shell (`[ -f … ]`, `$HOME`). On Windows where ZCode runs, this may fail. Consider emitting a `"type": "process"` entry for the ZCode agent specifically (argv-based, no shell) to guarantee cross-platform behavior. This is the single biggest risk in this workstream.

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

This is the single biggest technical risk. Three required behaviors and how to achieve them on Win32:

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

The sidecar is spawned as `node server.js`. On Windows, `node` may not be on `PATH` in all contexts. The Tauri `lib.rs:124-147` already searches `C:\Program Files\nodejs`, `%APPDATA%\nvm`, `%USERPROFILE%\.fnm`, scoop shims. **Verify** the spawn path resolves on a clean Windows 11 install; if not, bundle a Node runtime or ship the sidecar pre-bundled via `bun build --target=bun` (no Node dependency). The sidecar's `sidecar/package.json` currently uses `bun build --target=node --format=cjs`, so it expects a host Node.

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

  Note: `running` (row 7) is "active task work" (thinking/typing), NOT locomotion. The 8x11 variant (`spriteVersionNumber 2`, `1536×2288`) adds 2 rows of "look directions" and is accepted by petdex's validator (`src/lib/submissions-validation.ts:80-92`) but is **not** required.

### 5.4 Feasibility verdict

**Feasible, with one hard constraint.** The workflow is deterministic and fully documented. The 7 Python scripts have exact CLI signatures and can be reimplemented in TypeScript (the project already uses `sharp` for image manipulation — see `submission-review.ts:1245` for an existing dHash-with-sharp pattern).

**The hard constraint: `gpt-image-2` has no native transparency.** Confirmed against OpenRouter's live endpoint: `background: ["auto", "opaque"]` only. Three options:

| Option | Transparency source | Cost | Recommendation |
| --- | --- | --- | --- |
| **C-1.** Use `openai/gpt-image-1` instead | Native alpha (`background: "transparent"`) | Higher per-image | **Simplest.** Drop-in; skips chroma-key pipeline. |
| **C-2.** Use `openai/gpt-image-2` + port hatch-pet's chroma-key pipeline | Deterministic color keying (generate on flat chroma bg, key out in post) | Lower per-image, higher code complexity | Best if the user specifically wants gpt-image-2's quality. This is exactly what hatch-pet does today. |
| **C-3.** Hybrid: gpt-image-2 for the base + gpt-image-1 for rows | Mixed | Medium | Over-engineered; avoid. |

**Recommendation: ship C-1 (gpt-image-1) first for fastest path to working pets, then offer C-2 as a "high quality (gpt-image-2)" toggle.** This keeps the initial scope small while honoring the user's gpt-image-2 request as a Phase 2.

### 5.5 OpenRouter API specifics (corrected)

Important: OpenRouter's image endpoint is **`POST /api/v1/images`**, NOT `/api/v1/images/generations` (the path differs from OpenAI's despite being "compatible"). Request shape:

```bash
curl -X POST "https://openrouter.ai/api/v1/images" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "model": "openai/gpt-image-1", "prompt": "...", "quality": "high", "background": "transparent", "output_format": "png" }'
```

Response: `{ "data": [{ "b64_json": "...", "media_type": "image/png" }], "usage": { "cost": 0.04 } }`. The model also supports `input_references` (0-16 images) for image-to-image — **this is how the identity lock works**: every row strip generation passes the canonical base as a reference.

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

### 5.7 Where the API key lives

The OpenRouter key must **never** be sent to the petdex backend (it's a user secret). Two options:

- **Desktop-side only (recommended):** store the key in the desktop settings (`~/.petdex/desktop-settings.json`), call OpenRouter directly from the desktop sidecar. Add a new sidecar endpoint `POST /generate` (gated by the existing `update-token`) that runs the generation pipeline. The web backend never sees the key.
- **CLI-side:** `petdex generate <description>` reads the key from env/keychain, runs the pipeline, writes to `~/.codex/pets/<id>/`.

Either way, generation is a **local-only** operation; the resulting pet is then submitted through the normal `petdex submit` flow if the user wants to publish it.

### 5.8 Validation invariant to enforce

`validate_atlas.py` enforces a transparency invariant: transparent pixels must not retain RGB residue (otherwise compositing produces halos). When porting to `validate-atlas.ts`, use `sharp` to scan for pixels where `alpha < threshold` but `R|G|B ≠ 0` and fail the build. This is the single most important quality gate.

### 5.9 Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| gpt-image-2 opacity only | **Certain** (verified) | Default to gpt-image-1 (native alpha); offer gpt-image-2 with chroma pipeline as opt-in |
| Identity drift across rows (pet looks different per state) | High | Enforce identity lock: pass canonical base as `input_references` on every row job (the hatch-pet approach) |
| Cost runaway (10 images/pet × $$) | Medium | Surface estimated cost before generation; cap at 1 retry per row |
| Frame misalignment in strips | Medium | Port `extract-strip-frames.ts` with the `stable-slots` method for QA correction |
| Prompt injection from user description | Low | Sanitize description; keep it out of system prompt (petdex already does this in `auto-tag.ts:101-122`) |
| OpenRouter rate limits | Low | Add exponential backoff; the existing `@upstash/ratelimit` pattern is a model |

---

## 6. Cross-Workstream Decisions To Confirm

These are decisions only the maintainer can make; they change scope.

1. **ZCode config paths** — confirm `~/.zcode/cli/config.json` and `~/.zcode/cli/commands/` are the stable, documented locations (read from the local install; not yet confirmed against published ZCode docs).
2. **Windows shell portability** — should the ZCode agent emit `"type": "process"` (argv, Windows-safe) instead of the default `"type": "command"` (shell, POSIX-only)? Recommend yes.
3. **Native shell choice** — adopt the existing Tauri scaffold (recommended) vs. extend the Zig `zero-native` fork with a Windows WebView2 module?
4. **gpt-image-2 vs gpt-image-1 default** — ship gpt-image-1 (native alpha, simplest) first, or commit to porting the chroma-key pipeline upfront for gpt-image-2?
5. **Where generation runs** — desktop sidecar (recommended, key stays local) vs. CLI command vs. new web route (not recommended; key handling risk)?
6. **Installer packaging** — bare `.exe` to `~/.petdex/bin/` (minimum viable, matches existing CLI contract) vs. MSI/NSIS installer (better UX)?

---

## 7. Suggested Build Order

Sequenced for fastest feedback and lowest risk first.

| Phase | Workstream | Deliverable | Why first |
| --- | --- | --- | --- |
| **1** | A | ZCode agent entry + tests | Smallest, most localized; immediately useful; validates the registry extension pattern |
| **2** | B (core) | Finish Tauri scaffold transparency/click-through + wire release asset | Unblocks `petdex init` on Windows; scaffold already exists |
| **3** | B (polish) | Port picker, drag physics, bubbles, deep-links from `main.zig` | Feature parity with macOS |
| **4** | B (CLI fixes) | `doctor.ts` Windows bugs (`HOME`→`USERPROFILE`, exec-bit, `lsof`→`netstat`) | Correctness on Windows |
| **5** | C (MVP) | In-app generation with **gpt-image-1** (native alpha) | Fastest path to working pets; skips chroma complexity |
| **6** | C (opt-in) | Add **gpt-image-2** path with ported chroma-key pipeline | Honors the user's specific gpt-image-2 request |

Phases 1-2 are independently shippable. Phase 5 can start in parallel with Phase 3.

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
- [gpt-image-2 transparency workaround (Reddit)](https://www.reddit.com/r/EntrepreneurRideAlong/comments/1stt5ok/added_gptimage2_support_had_to_build_transparency/)

### Windows overlay / WebView2
- [Faksimile/WebView2-Click-Through (demo of dynamic hit-testing)](https://github.com/Faksimile/WebView2-Click-Through)
- [WebView2Feedback #1004 — transparency & click-through](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1004)
- [Tauri issue #13070 — click-through feature request](https://github.com/tauri-apps/issues/13070)
- [Tauri v2 Window Customization docs](https://v2.tauri.app/learn/window-customization/)
- [webview/webview (cross-platform C webview lib)](https://github.com/webview/webview)
- [SO: pass clicks through a transparent always-on-top window](https://stackoverflow.com/questions/39855720/windows-forms-pass-clicks-through-a-partially-transparent-always-on-top-window)

### ZCode hooks
- `C:\Users\predator\.zcode\cli\plugins\cache\zcode-plugins-official\zcode-guide\0.1.0\skills\diagnosing-hooks\SKILL.md` (authoritative — 7 events)
- `C:\Users\predator\.zcode\cli\plugins\cache\zcode-plugins-official\zcode-guide\0.1.0\skills\zcode-configuration-guide\SKILL.md`

### Codebase references (internal)
- `packages/petdex-cli/src/hooks/agents.ts` — agent registry (the extension point)
- `packages/petdex-cli/src/hooks/install.ts` / `uninstall.ts` — generic install/uninstall (no change needed)
- `packages/petdex-desktop/src/main.zig` — macOS native app (port source for Windows features)
- `packages/petdex-desktop/sidecar/server.ts` — cross-platform sidecar (Windows-compatible except self-updater)
- `packages/petdex-desktop-windows/` — existing Tauri scaffold (the Windows shell to finish)
- `packages/petdex-cli/src/desktop/install.ts` / `process.ts` / `doctor.ts` — CLI desktop layer (doctor has Windows bugs)
- `src/lib/submissions-validation.ts:80-92` — atlas grid validation (8x9 / 8x11)
- `src/lib/db/schema.ts:680` — `agent_source` is free-form text (no backend migration for ZCode)
