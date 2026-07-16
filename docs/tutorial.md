# Tutorial: Try the three new features on Windows

This walks you through **ZCode hooks**, the **Windows desktop overlay**, and
**in-app pet generation** — the three workstreams from `docs/implementation.md`.

You run everything from **Command Prompt** (`cmd.exe`). Two bootstrap launchers
(`setup.cmd`, `run.cmd`) handle the runtime: they find or install Bun, so you
do **not** need Node, and you do not need Bun pre-installed or on your PATH.

> **One rule that matters most:** after `setup.cmd` finishes, **close and reopen
> your terminal**. Setup writes `bun` and `petdex` to your User PATH, but PATH
> changes only apply to terminals opened *after* the write. This is the #1 source
> of "command not found" confusion.

---

## Prerequisites

1. **Windows 11** (the desktop shell is Windows-only).
2. **Git**, to clone the repo:
   ```cmd
   git clone https://github.com/predator17/petdex.git
   cd petdex
   ```
3. **An OpenRouter API key** — *only for pet generation (Step 4).* Get one at
   `https://openrouter.ai/keys`. Skip this if you only want the hooks + overlay.

**You do NOT need:** Node.js, Bun (pre-installed), or Rust. `setup.cmd` installs
Bun for you; the repo ships a prebuilt desktop exe. (Rust is only needed to
*rebuild* the exe — see "Rebuilding the desktop exe" at the end.)

---

## Step 1 — One-command setup

Open **Command Prompt** (`cmd.exe`) in the `petdex` folder (the repo root), then:

```cmd
setup.cmd
```

`setup.cmd` finds Bun (or installs it if missing) and runs the full setup. You'll
see eleven steps, each with a ✓ or ✗:

```
[1/5]   Check Bun runtime        ✓ Bun
[2/5]   Build CLI + sidecar      ✓ petdex CLI / ✓ sidecar
[3/5]   Stage runtime files      ✓ sidecar / ✓ desktop exe / ✓ petdex shim / ✓ PATH
[3.5/5] Starter pet              ✓ starter pet
[4/5]   Install ZCode hooks      ✓ persisted CLI / ✓ ZCode hooks
[5/5]   OpenRouter API key       ✓ OpenRouter key (or "not set" — see below)
```

What it did:
- Built the CLI + sidecar and staged them under `~\.petdex\` (the loader's expected locations).
- Installed a starter pet so the overlay isn't empty on first launch.
- Wrote the ZCode hooks to `~\.zcode\cli\config.json`.
- Created a `petdex` command shim and added `~\.bun\bin` + `~\.petdex\bin` to your User PATH.

**Now close this cmd window and open a new one** (so `bun` and `petdex` are on PATH).

> **Add your OpenRouter key** (only needed for Step 4 — pet generation):
> In the repo root, create a file named `.env.local` with one line:
> ```
> OPENROUTER_API_KEY=sk-or-v1-...your key...
> ```
> `.env.local` is gitignored — it never gets committed. Then re-run `setup.cmd`
> so it copies the key into the local key store (`~\.petdex\runtime\openrouter-key`).

---

## Step 2 — Try the ZCode hooks

Open a **fresh** cmd window (post-setup) and verify the hooks landed:

```cmd
type "%USERPROFILE%\.zcode\cli\config.json"
```

You should see `"hooks": { "enabled": true, "events": { ... } }` with **seven
events** (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `PermissionRequest`, `Stop`), each a `"type": "process"`
argv pointing at `~\.petdex\bin\petdex.js bubble …`.

Confirm the CLI detects its own hooks:

```cmd
petdex doctor
```

Scroll to the **Agents** section — ZCode should show "hooks + /petdex installed".

> If `petdex` isn't recognized, you skipped the terminal reopen. Close and reopen
> cmd, or call the shim directly: `"%USERPROFILE%\.petdex\bin\petdex.cmd" doctor`.

**See it react:** launch the desktop (Step 3), then use ZCode normally — run a
tool, send a prompt. The pet flips states: `running` while a tool works, `idle`
after, `failed` if a tool errors (`PostToolUseFailure` — new for ZCode), `waving`
at turn end, `jumping` on a prompt.

To uninstall just the ZCode hooks later:
```cmd
petdex hooks uninstall
```

---

## Step 3 — Launch the desktop overlay

From the repo root (any cmd window — `run.cmd` finds Bun for you):

```cmd
run.cmd
```

A small floating pet appears on top of your windows. It's transparent and
always-on-top. Try these interactions:

| Action | Effect |
|---|---|
| **Drag the pet** | It follows your cursor, then **coasts** with momentum on release |
| **Move cursor off the pet** | Transparent areas become **click-through** — clicks pass to the desktop |
| **Hover the pet** | It's grabbable again (drag works) |
| **Shift+click the pet** | Opens the **pet picker** (480×420 grid of installed pets) |
| **Middle-click the pet** | Opens the **Settings panel** (API key + cost estimate) |
| **Right-click the pet** | Quit |

If the overlay shows nothing or "no pet found", install a real one (browse
slugs at `https://petdex.dev`):
```cmd
petdex install <slug>
```

> **About the starter pet:** if your machine couldn't reach `petdex.dev` during
> setup, the starter is a transparent placeholder — the overlay will look empty.
> Install a real pet with `petdex install <slug>`, or generate one (Step 4).

---

## Step 4 — Generate a pet with gpt-image-2 (costs ~$0.40)

Make sure your key is in `.env.local` and you've re-run `setup.cmd` (Step 1).
Then from the repo root:

```cmd
run.cmd --generate
```

What happens:
1. `run-desktop.ts` reads `OPENROUTER_API_KEY` from `.env.local`.
2. It starts the sidecar, posts to `POST /generate` with the mandatory
   cost-confirmation flag, and the server runs the full pipeline:
   - 1 base portrait + 9 animation-row strips via **gpt-image-2** (identity-
     locked — every row references the base so the pet looks consistent).
   - Each strip is **chroma-keyed** (gpt-image-2 can't emit transparency, so
     we generate on flat green and key it out in post).
   - Frames are composed into a 1536×1872 (8×9) atlas and **validated** (grid
     ratio + transparency invariant — no RGB residue under low alpha).
3. The pet lands in `~\.petdex\pets\my-pet\` and is set active.
4. The desktop launches and renders your generated pet.

**Customize** the pet by setting env vars before the command:
```cmd
set PETDEX_PET_NAME=Bolt
set PETDEX_PET_ID=bolt
set PETDEX_PET_DESC=a small lightning spirit, electric blue, glowing
run.cmd --generate
```

> **Cost guardrail:** the server hard-rejects generation unless the client
> asserts `confirmCost:true` (the script always does). Estimate: ~$0.40 (10
> images) up to ~$0.80 (with retries). You'll see this in the Settings panel.

This takes **2–4 minutes** (10 image generations). Watch the terminal. If it
fails, the error names the failing row; re-run to retry.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `'bun' is not recognized` after running setup.cmd | **Close and reopen your terminal.** Setup added `~\.bun\bin` to your User PATH, but it only applies to terminals opened *after* the write. |
| `'petdex' is not recognized` | Same fix — reopen the terminal. Or call the shim directly: `"%USERPROFILE%\.petdex\bin\petdex.cmd" doctor`. |
| `setup.cmd` says "Bun install failed" | Your network/proxy blocked the download. Install Bun manually from `https://bun.sh`, then re-run `setup.cmd`. |
| Overlay shows nothing / "no pet found" | `petdex install <slug>` (browse at petdex.dev), or generate one (Step 4). |
| Overlay won't start | Re-run `setup.cmd` — it re-stages `~\.petdex\sidecar\server.js` and the desktop exe. |
| White box / hard edges around pet | The WebView2 transparency tuning surface (§4.4). Known risk; report your GPU/driver. |
| Generation: `no_api_key` | Put `OPENROUTER_API_KEY=...` in `.env.local`, then re-run `setup.cmd`. |
| Generation: `cost_confirmation_required` | Only happens if you call `/generate` manually — add `"confirmCost":true` to the body. `run.cmd --generate` does this automatically. |
| Generation looks stuck for minutes | It's not — 10 image gens are slow. Wait 2–4 min. |

---

## Rebuilding the desktop exe (optional)

The repo ships a prebuilt exe, so you can skip this. To rebuild from source:

1. Install **`rustup`** (`https://rustup.rs`) and the **"Desktop development with
   C++"** workload from Visual Studio Build Tools (provides the MSVC linker).
2. Build it:
   ```cmd
   cd packages\petdex-desktop-windows\src-tauri
   cargo build --release
   ```
   The exe lands at `target\release\petdex-desktop-win32-x64.exe`.
3. Re-run `setup.cmd` to re-stage the fresh exe into `~\.petdex\bin\`.

---

## What each feature maps to in the plan

| Feature | Plan section | Where in code |
|---|---|---|
| ZCode hooks (7 events, `type:process`) | §3 | `packages\petdex-cli\src\hooks\agents.ts` |
| doctor.ts Windows fixes + find_node | §4.6–4.7 | `packages\petdex-cli\src\desktop\doctor.ts`, `src-tauri\src\lib.rs` |
| Transparency + click-through | §4.4 | `src-tauri\src\transparency.rs` |
| Drag physics, picker, settings, deep-links | §4.5 | `ui\index.html`, `src-tauri\src\lib.rs` |
| Release pipeline | §4.8 | `scripts\release-desktop.ts` |
| Chroma-key + generation pipeline | §5.4–5.6 | `packages\petdex-desktop-windows\generation\` |
| Security (token-gate, cost, sanitize, key ACL) | §5.7 | `sidecar\server.ts`, `sidecar\prompt-sanitize.ts` |
