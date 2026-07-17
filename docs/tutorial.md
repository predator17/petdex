# Petdex Desktop — Quick Start Guide

A floating pet that lives on your Windows desktop and reacts to your coding
activity. This guide assumes **zero technical background** — every step is
 spelled out.

---

## What you'll get

- A small animated character that floats on top of your windows
- It **reacts to ZCode**: jumps when you send a prompt, runs when a tool
  works, waves when a turn ends
- You can **drag it** around your screen (drag fast for a special effect!)
- You can **swap pets** from the online library (3700+ available, all free)

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
- Installs Bun (the tool that runs the project — you don't need to know what it is)
- Builds the desktop pet app
- Connects it to ZCode (so the pet reacts to your coding)
- Sets everything up so you can just launch it

You'll see a list of green checkmarks as each step completes. If everything
shows ✓, you're ready.

**Important:** after setup finishes, **close your Command Prompt window and
open a new one**. This is needed for Windows to recognize the new commands.
(It's like restarting after installing an app.)

---

## Step 3 — Get a pet from the library

There are thousands of free pets online. Browse them at
https://petdex.dev — pick any name you like.

To install one, in your **new** Command Prompt:

```
petdex install aurelion-sol
```

(Replace `aurelion-sol` with any pet name you found on the website.)

You can install as many as you want:

```
petdex install firefly
petdex install geometry-dash-cube
```

---

## Step 4 — Launch the pet

```
run.cmd
```

A small floating character appears on your screen (usually near the
top-left corner). It's alive!

### Things to try:

| Action | What happens |
|---|---|
| **Click and drag the character** | It follows your mouse. Drag **fast** for a glow effect! |
| **Red ✕ button** (top-right of the pet) | Closes the pet |
| **Right-click** the pet | Also closes it |
| **Use ZCode normally** | The pet reacts: runs when you use tools, waves when you finish, jumps when you send a prompt |

---

## Step 5 — Connect it to ZCode (automatic!)

The setup in Step 2 already connected the pet to ZCode. Once both ZCode and
the pet are running, the pet will **automatically react** to what you do:

| You do in ZCode | The pet does |
|---|---|
| Send a message / prompt | 🐰 **Jumps** (excited!) |
| ZCode reads or edits a file | 🏃 **Runs** (working hard) |
| A tool finishes | 😌 **Idle** (taking a breath) |
| A tool hits an error | 💥 **Shows the error state** |
| ZCode needs your permission | 🙋 **Waits** for you |
| ZCode finishes its response | 👋 **Waves** (done!) |

You don't need to do anything special — just use ZCode as normal and watch
the pet react in real-time.

---

## Switching pets

To switch to a different pet you've installed:

1. Make sure the pet is running (`run.cmd`)
2. **Shift+click** the pet → a grid of all your installed pets appears
3. Click the one you want

Or from Command Prompt:

```
petdex install <new-pet-name>
run.cmd
```

---

## Shutting down

- **To close the pet**: click the red ✕ button, or right-click it
- **To temporarily disable ZCode reactions** (pet stays but stops reacting):
  ```
  petdex down
  ```
- **To re-enable reactions**:
  ```
  petdex up
  ```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `'bun' is not recognized` | Close and reopen Command Prompt. If that doesn't work, run `setup.cmd` again. |
| `'petdex' is not recognized` | Same — close and reopen Command Prompt. |
| `'run.cmd' is not recognized` | Make sure you're in the `petdex` folder: `cd petdex` |
| Pet doesn't appear | Wait 5 seconds after `run.cmd`. If still nothing, run `setup.cmd` again. |
| Pet appears but is blank/dark | The pet's image might be too large. Try a different pet: `petdex install firefly` |
| Pet doesn't react to ZCode | Make sure the sidecar is running. In Command Prompt: `"%USERPROFILE%\.bun\bin\bun.exe" "%USERPROFILE%\.petdex\sidecar\server.js"` |
| Setup says "Bun install failed" | Your internet connection or proxy may be blocking the download. Try a VPN, or install Bun manually from https://bun.sh |

---

## Quick reference (all commands)

| Command | What it does |
|---|---|
| `setup.cmd` | First-time setup (installs everything) |
| `run.cmd` | Launch the floating pet |
| `petdex install <name>` | Download a pet from the library |
| `petdex up` | Enable ZCode reactions |
| `petdex down` | Disable ZCode reactions |
| `petdex toggle` | Toggle reactions on/off |
| `petdex doctor` | Check if everything is working |

---

## FAQ

**Q: Do I need to know programming to use this?**
No. Follow Steps 1–4 above. The setup handles everything.

**Q: Does this cost money?**
No. All pets in the library are free. (Generating your own pet with AI costs
a few cents, but that's an optional advanced feature.)

**Q: Will the pet slow down my computer?**
No. It's a tiny window with a small animation — lighter than a browser tab.

**Q: Can I use this with Claude Code or Codex instead of ZCode?**
Yes! Run `petdex init` and select which agents you use. The pet reacts to
all of them.

**Q: How do I generate my own custom pet with AI?**
That's an advanced feature. Put your OpenRouter API key in a file called
`.env.local` in the project folder, then:
```
set PETDEX_PET_NAME=My Pet
set PETDEX_PET_DESC=a friendly robot cat, blue and silver
run.cmd --generate
```
This costs about $0.40 per pet (10 AI-generated images).
