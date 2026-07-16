# Tutorial: Try the three new features on Windows

This walks you through **ZCode hooks**, the **Windows desktop overlay**, and
**in-app pet generation** — the three workstreams from `docs/implementation.md`.

Two helper scripts do all the heavy lifting. You run everything from a
terminal; the scripts handle building, staging, and launching.

> **Terminal choice:** plain **Command Prompt** (`cmd.exe`), **PowerShell**,
> or **Git Bash** all work. The examples below use `cmd.exe`. If a command
> says `bun: not found`, close and reopen your terminal after the setup step
> (it adds Bun to your PATH).

---

## Prerequisites

1. **Windows 11** (the desktop shell is Windows-only).
2. **Git**, to clone the repo:
   ```cmd
   git clone https://github.com/predator17/petdex.git
   cd petdex
   ```
3. **Rust + the MSVC Build Tools** — *only needed if you want to rebuild the
   desktop exe yourself.* The repo ships a prebuilt exe via the setup step, so
   you can **skip Rust** for a first run. To rebuild later: install
   `rustup` (`https://rustup.rs`) and the "Desktop development with C++"
   workload from Visual Studio Build Tools, then run
   `cargo build --release` in `packages\petdex-desktop-windows\src-tauri`.

That's it. Bun is installed for you by the setup step if it's missing.

---

## Step 1 — One-command setup

From the repo root:

```cmd
powershell -c "irm bun.sh/install.ps1 | iex"
```

(Install Bun if you don't have it — the official installer. Then reopen your
terminal so `bun` is on your PATH.)

Now run the setup script. It is **idempotent** — safe to re-run any time:

```cmd
bun scripts\setup-windows.ts
```

You'll see nine steps, each with a ✓ or ✗:

```
[1/5] Check Bun runtime               ✓ Bun — on PATH (1.3.x) + added to User PATH
[2/5] Build petdex CLI + sidecar      ✓ petdex CLI / ✓ sidecar
[3/5] Stage runtime files             ✓ sidecar / ✓ desktop exe
[3.5/5] Starter pet                   ✓ starter pet
[4/5] Install ZCode hooks             ✓ persisted CLI / ✓ ZCode hooks
[5/5] OpenRouter API key              ✓ OpenRouter key (owner-only)
```

What it did:
- Built the CLI (`packages\petdex-cli\dist\petdex.js`) and sidecar.
- Staged them to `~\.petdex\` (the loader's expected locations).
- Installed a starter pet so the overlay isn't empty.
- Wrote the ZCode hooks to `~\.zcode\cli\config.json`.
- Added Bun to your User PATH (reopen terminals to pick it up).

> **Add your OpenRouter key** (only needed for pet generation, Step 4):
> create a file named `.env.local` in the repo root with one line:
> ```
> OPENROUTER_API_KEY=sk-or-v1-...your key...
> ```
> `.env.local` is gitignored — it never gets committed. Get a key at
> `https://openrouter.ai/keys`. Then re-run `bun scripts\setup-windows.ts`
> so it copies the key into the local key store.

---

## Step 2 — Try the ZCode hooks

This is pure config — no desktop needed. After setup, verify the hooks landed:

```cmd
type "%USERPROFILE%\.zcode\cli\config.json"
```

You should see `"hooks": { "enabled": true, "events": { ... } }` with **seven
events** (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `PermissionRequest`, `Stop`), each a `"type": "process"`
argv pointing at `~\.petdex\bin\petdex.js bubble …`.

Run the CLI's diagnostic to confirm detection:

```cmd
node "%USERPROFILE%\.petdex\bin\petdex.js" doctor
```

Under **Agents**, ZCode should report "hooks + /petdex installed".

**See it react:** start the desktop (Step 3), then use ZCode normally — run a
tool, send a prompt, etc. The pet flips states: `running` while a tool works,
`idle` after, `failed` if a tool errors (`PostToolUseFailure` — new for ZCode),
`waving` at turn end, `jumping` on a prompt.

To uninstall just the ZCode hooks later:
```cmd
node "%USERPROFILE%\.petdex\bin\petdex.js" hooks uninstall
```

---

## Step 3 — Launch the desktop overlay

```cmd
bun scripts\run-desktop.ts
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

> The click-through + transparency (§4.4) is the part most sensitive to your
> GPU/driver. If you see a white box or hard color fringes instead of clean
> edges, that's the known WebView2-transparency tuning surface.

If the overlay shows nothing or "no pet found", install a real one:
```cmd
node "%USERPROFILE%\.petdex\bin\petdex.js" install <slug>
```
Browse slugs at `https://petdex.dev`.

---

## Step 4 — Generate a pet with gpt-image-2 (costs ~$0.40)

Make sure your OpenRouter key is in `.env.local` (Step 1) and re-run setup so
it's staged. Then:

```cmd
bun scripts\run-desktop.ts --generate
```

What happens:
1. The script reads `OPENROUTER_API_KEY` from `.env.local`.
2. It starts the sidecar, posts to `POST /generate` with the cost-confirmation
   flag, and the server runs the full pipeline:
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
bun scripts\run-desktop.ts --generate
```

> **Cost guardrail:** the server hard-rejects generation unless the client
> asserts `confirmCost:true`. The script always does. The estimate is ~$0.40
> (10 images) up to ~$0.80 (with retries). You see this in the Settings panel.

This takes **2–4 minutes** (10 image generations). Watch the terminal for
progress. If it fails, the error names the failing row; re-run to retry.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bun: not found` | Close and reopen your terminal (setup added it to PATH). Or run the script as `"%USERPROFILE%\.bun\bin\bun.exe" scripts\setup-windows.ts` |
| Overlay shows nothing / "no pet found" | `node "%USERPROFILE%\.petdex\bin\petdex.js" install <slug>` (browse at petdex.dev) |
| Overlay won't start | Ensure `~\.petdex\sidecar\server.js` and `~\.petdex\bin\petdex-desktop-win32-x64.exe` exist — re-run setup |
| White box / hard edges around pet | The WebView2 transparency tuning surface (§4.4). Known risk; report your GPU/driver |
| Generation: `no_api_key` | Put `OPENROUTER_API_KEY=...` in `.env.local`, re-run setup |
| Generation: `cost_confirmation_required` | The script sets the flag automatically; if you call `/generate` manually, add `"confirmCost":true` to the body |
| Generation: 2-4 min, looks stuck | It's not — 10 image gens are slow. Watch the terminal |

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
