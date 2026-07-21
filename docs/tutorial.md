# Petdex Desktop — Quick Start Guide

A floating pet that lives on your Windows desktop and reacts to your coding
activity in ZCode. This guide assumes **zero technical background** — every
step is spelled out.

---

## What you'll get

- A small animated character that floats on top of your windows
- **Drag it** around your screen — drag right and it runs right, drag left and
  it runs left, drag fast and it glows gold with a "whoosh!"
- **Reacts to ZCode**: jumps when you send a prompt, runs when a tool works,
  waves when a turn ends
- **Browse 3700+ free pets** from a built-in gallery — each showing a live
  idle animation preview. Sprites are cached to disk after first view, so the
  gallery opens instantly on every launch after the first.
- **Switch between installed pets** without re-downloading — pick any pet
  you've installed from a switcher panel
- **Settings panel** for connecting your OpenRouter API key (optional, for AI
  pet generation)

---

## Before you start

You need two things:

1. **Git** — to download the project. If you don't have it, get it from
   https://git-scm.com (download → install → keep clicking Next).
2. **Windows 11** — the desktop pet only runs on Windows.

That's it. Everything else is installed automatically.

---

## Step 1 — Download the project

Open **Command Prompt** (press the Windows key, type `cmd`, press Enter) and
run:

```
git clone https://github.com/predator17/petdex.git
cd petdex
```

This downloads the project and moves you into its folder.

---

## Step 2 — One-click setup

Still in Command Prompt, run:

```
setup.cmd
```

This single command does everything:
- Installs Bun (the runtime that powers the project)
- Builds the desktop pet application
- Connects it to ZCode (so the pet reacts to your coding)
- Adds `bun` and `petdex` commands to your system PATH

You'll see a list of green checkmarks as each step completes.

**Important:** after setup finishes, **close your Command Prompt window and
open a new one**. This lets Windows recognize the new commands.

---

## Step 3 — Install a pet

There are thousands of free pets. Two ways to get one:

### Option A: From the command line

```
petdex install aurelion-sol
```

Browse available names at https://petdex.dev.

### Option B: From the in-app gallery (after launching)

Click the **blue eye button** (👁) on the pet widget to open a gallery with
all 3700+ pets. Each card shows a **live idle animation** so you can see how
the pet looks before installing. Scroll to browse, or type in the search box
to filter. Filter by category using the tabs at the top: **All /
Characters / Creatures / Objects**.

The first time you open the gallery, sprites download from the petdex.dev
CDN (each sprite is ~2 MB, so the first page of 24 takes a few seconds).
After that, every sprite you've viewed is cached on disk under
`%USERPROFILE%\.petdex\cache\sprites\` — subsequent gallery opens are
instant, even after restarting your computer. The app also warms the first
24 sprites in the background right after launch.

---

## Step 4 — Launch the pet

```
run.cmd
```

A small floating character appears on your screen (near the top-left corner).
It's alive!

### Things to try:

| Action | What happens |
|---|---|
| **Click and drag the character** | The window follows your mouse. **Drag right** → pet runs right. **Drag left** → pet runs left. **Drag fast** → golden glow + "whoosh!" |
| **Release after dragging** | Pet waves ("Done."), then returns to idle |
| **Blue 👁 button** (top-right) | Opens the **pet gallery** — browse and search all pets with live animation previews |
| **Green ⟳ button** (top-right) | Opens the **pet switcher** — list of pets you've installed. Click **Activate** to switch, **Remove** to uninstall |
| **Middle-click** the pet | Opens the **settings panel** (API key + cost info) |
| **Red ✕ button** (top-right) | Closes the pet |
| **Right-click** the pet | Also closes it |

> The three buttons in the top-right corner are, from right to left: **red ✕**
> (close), **blue 👁** (gallery), **green ⟳** (switcher). Hover over them to
> see them brighten.

---

## Step 5 — ZCode reactions (automatic!)

The setup in Step 2 already connected the pet to ZCode. Once both ZCode and
the pet are running, the pet **automatically reacts** to what you do:

| You do in ZCode | The pet does |
|---|---|
| Send a message / prompt | 🐰 **Jumps** + "Thinking…" bubble |
| ZCode reads or searches a file | 📖 **Reviews** + "Reading X" bubble |
| ZCode edits or writes a file | 🏃 **Runs** + "Editing X" bubble |
| A tool finishes | 😌 **Idle** (taking a breath) |
| A tool hits an error | 💥 **Shows the error state** |
| ZCode needs your permission | 🙋 **Waits** for you |
| ZCode finishes its response | 👋 **Waves** + "Done." bubble |

You don't need to do anything special — just use ZCode as normal and watch
the pet react in real-time.

---

## Shutting down

| Command / Action | What it does |
|---|---|
| **Red ✕ button** or **right-click** | Closes the pet widget |
| `petdex down` | Disables ZCode reactions (pet stays but stops reacting) |
| `petdex up` | Re-enables reactions |
| `petdex toggle` | Toggle reactions on/off (also what `/petdex` does in ZCode) |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `'bun' is not recognized` | Close and reopen Command Prompt. If that doesn't work, run `setup.cmd` again. |
| `'petdex' is not recognized` | Same — close and reopen Command Prompt. |
| `'run.cmd' is not recognized` | Make sure you're in the `petdex` folder: `cd petdex` |
| Pet doesn't appear | Wait 5–8 seconds after `run.cmd` (WebView2 needs to initialize). If still nothing, run `setup.cmd` again. If the launcher exited silently, a corrupted WebView2 profile may be to blame — delete `%LOCALAPPDATA%\run.crafter.petdex` and relaunch. |
| Pet appears but is blank/dark | This is the dark background `#0a0a1a` — see the FAQ below. The pet itself should be visible against it. If the sprite doesn't render at all, the on-disk sprite may be missing or oversized; reinstall the pet: `petdex install aurelion-sol`. |
| Pet doesn't react to ZCode | Ensure the sidecar is running. In Command Prompt: `"%USERPROFILE%\.bun\bin\bun.exe" "%USERPROFILE%\.petdex\sidecar\server.js"` |
| Drag direction seems wrong | Make sure you're using the latest build — run `setup.cmd` then `run.cmd` again. The drag tracker was fixed to record the pre-drag position correctly. |
| Gallery button doesn't work | The blue 👁 button opens the gallery. If nothing happens, the JS may not have loaded — close the pet and relaunch with `run.cmd`. |
| Gallery takes a long time to load | First open downloads sprites from the CDN (~2 MB each). Subsequent opens are instant because sprites are cached on disk. To pre-warm the cache, just scroll through the gallery once. |
| Switcher "Remove" button doesn't work | Restart the pet with `run.cmd` — older builds only checked `~/.petdex/pets` for uninstall. The current build searches both `~/.petdex/pets` and `~/.codex/pets`. |
| Settings panel won't close | Click the red **X** in the top-right corner of the panel. |
| Setup says "Bun install failed" | Your internet connection or proxy may be blocking the download. Install Bun manually from https://bun.sh |

---

## Quick reference (all commands)

| Command | What it does |
|---|---|
| `setup.cmd` | First-time setup (installs everything) |
| `run.cmd` | Launch the floating pet |
| `run.cmd --generate` | Generate a new pet via AI first, then launch (needs OpenRouter key, see FAQ) |
| `petdex install <name>` | Download a pet from the library |
| `petdex install <a> <b> <c>` | Download several pets at once |
| `petdex select [slug]` | Set the active pet (no arg = pick interactively) |
| `petdex list` | Browse the pet library from the terminal |
| `petdex up` | Enable ZCode reactions |
| `petdex down` | Disable ZCode reactions |
| `petdex toggle` | Toggle reactions on/off |
| `petdex doctor` | Diagnose install / runtime / agent wiring |
| `petdex update` | Pull the latest petdex-desktop release and restart |

> The green **⟳ switcher button** on the widget and `petdex select` do the
> same thing — both pick which installed pet is currently active. The
> switcher also lets you **Remove** (uninstall) a pet.

---

## FAQ

**Q: Do I need to know programming to use this?**
No. Follow Steps 1–4 above. The setup handles everything.

**Q: Does this cost money?**
No. All pets in the library are free. (Generating your own pet with AI costs
a few cents, but that's an optional advanced feature.)

**Q: Will the pet slow down my computer?**
No. It's a tiny window with a small animation — lighter than a browser tab.
The on-disk sprite cache can grow to a few GB if you browse the whole
library (3700+ pets × ~2 MB each); clear it any time by deleting
`%USERPROFILE%\.petdex\cache\sprites\`.

**Q: Can I use this with Claude Code or Codex instead of ZCode?**
Yes! Run `petdex init` and select which agents you use. The pet reacts to
all of them.

**Q: How do I generate my own custom pet with AI?**
Put your OpenRouter API key in a file called `.env.local` in the project
folder:
```
OPENROUTER_API_KEY=sk-or-v1-...your key...
```
Then run `setup.cmd` again to stage the key, and:
```
set PETDEX_PET_NAME=My Pet
set PETDEX_PET_DESC=a friendly robot cat, blue and silver
run.cmd --generate
```
This costs about $0.40 per pet (10 AI-generated images). Use a simple,
concrete description — edgy/abstract terms may trip the safety filter.

**Q: The pet widget shows a dark background instead of being transparent. Is
that normal?**
Yes. On some Windows setups, WebView2's transparency doesn't composite
correctly, so the widget uses a dark background (`#0a0a1a`) instead. The pet
sprite renders fully visible against this background.

**Q: Where are my installed pets stored?**
Pets live under `%USERPROFILE%\.petdex\pets\<slug>\` and, for compatibility
with the original Codex pet shell, also under `%USERPROFILE%\.codex\pets\`.
Installing a pet writes to both. Either folder can be deleted manually to
free space — the pet will simply be re-downloaded next time you install it.

**Q: How does the drag work?**
When you click and drag the pet, Windows moves the window natively. After you
release, the pet briefly shows a directional running animation (right or left
based on which way you dragged) with optional golden glow for fast drags, then
waves and returns to idle. This matches the original macOS behavior.
