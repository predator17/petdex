/**
 * scripts/setup-windows.ts — one-command setup for the Windows desktop pet.
 *
 * Run from cmd.exe, PowerShell, or Git Bash:
 *
 *   bun scripts/setup-windows.ts
 *   node --experimental-strip-types scripts/setup-windows.ts   (no bun)
 *
 * What it does (idempotent — safe to re-run):
 *   1. Verifies Bun is reachable (and offers the fix if not).
 *   2. Builds the petdex CLI (dist/petdex.js) + the sidecar (server.js).
 *   3. Stages the sidecar + Tauri desktop exe where the loader expects
 *      them (~/.petdex/sidecar/server.js, ~/.petdex/bin/petdex-desktop-win32-x64.exe).
 *   4. Installs ZCode hooks non-interactively (writes ~/.zcode/cli/config.json).
 *   5. Reads OPENROUTER_API_KEY from .env.local (if present) and writes it
 *      to the local sidecar key store with owner-only ACL.
 *
 * Each step prints a clear ✓/✗ line. A failure in one step does NOT abort
 * the rest (so a missing key doesn't block the hooks install, etc.) — the
 * summary at the end tells you exactly what to do next.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Resolve the repo root: __dirname (bun/ts) for the canonical location,
// with process.cwd() as a fallback when invoked via a copied/temp path.
function findRepoRoot(): string {
  try {
    const here = dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const candidate = resolve(here, "..");
    if (existsSync(join(candidate, "package.json"))) return candidate;
  } catch {}
  // Fall back to CWD (the script is always run from the repo root).
  if (existsSync(join(process.cwd(), "package.json"))) return process.cwd();
  throw new Error(
    `could not locate repo root (script ran from ${process.cwd()})`,
  );
}
const REPO = findRepoRoot();
const HOME = homedir();
const PETDEX_DIR = join(HOME, ".petdex");
const BIN_DIR = join(PETDEX_DIR, "bin");
const SIDECAR_DIR = join(PETDEX_DIR, "sidecar");

type Step = { ok: boolean; label: string; detail?: string };
const steps: Step[] = [];
const log = (s: string) => console.log(s);

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function ok(label: string, detail?: string) {
  steps.push({ ok: true, label, detail });
  log(`  \u2713 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
}
function fail(label: string, detail?: string) {
  steps.push({ ok: false, label, detail });
  log(`  \u2717 ${label}${detail ? ` \u2014 ${detail}` : ""}`);
}

// ── 0. Bun ────────────────────────────────────────────────────────────
function stepBun(): boolean {
  log("\n[1/5] Check Bun runtime");
  // Resolve via the well-known install location (PATH may not have it).
  const candidate = join(
    HOME,
    ".bun",
    "bin",
    process.platform === "win32" ? "bun.exe" : "bun",
  );
  const onPath = run("bun", ["--version"]);
  if (onPath.status === 0) {
    ok("Bun", `on PATH (${onPath.stdout.trim()})`);
    return true;
  }
  if (existsSync(candidate)) {
    const v = run(candidate, ["--version"]);
    if (v.status === 0) {
      ok("Bun", `${candidate} (${v.stdout.trim()})`);
      return true;
    }
  }
  fail(
    "Bun",
    'not found. Install: powershell -c "irm bun.sh/install.ps1 | iex"',
  );
  return false;
}

// ── 0b. Persist PATH (so a fresh terminal finds bun + petdex) ─────────
// Runs unconditionally on Windows — writes ~/.bun/bin AND ~/.petdex/bin
// to the User PATH via .NET (idempotent, no shell-string parsing). This
// MUST be reliable: without it, `petdex` / `bun` aren't recognized in a
// newly-opened cmd window.
function stepPersistPath(): void {
  if (process.platform !== "win32") return;
  const ps = [
    "$bun = Join-Path $env:USERPROFILE '.bun\\bin'",
    "$pet = Join-Path $env:USERPROFILE '.petdex\\bin'",
    "$cur = [Environment]::GetEnvironmentVariable('Path','User')",
    "if ($cur -eq $null) { $cur = '' }",
    "$parts = $cur.Split(';') | Where-Object { $_ -ne '' }",
    "$add = @()",
    "if ($parts -notcontains $bun) { $add += $bun }",
    "if ($parts -notcontains $pet) { $add += $pet }",
    "if ($add.Count -gt 0) { $new = ($parts + $add) -join ';'; [Environment]::SetEnvironmentVariable('Path', $new, 'User'); Write-Output ('ADDED:' + ($add -join ',')) } else { Write-Output 'PRESENT' }",
  ].join("; ");
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  const out = r.stdout.trim();
  if (r.status === 0 && out.startsWith("ADDED:")) {
    ok(
      "PATH",
      `added ${out.slice(6)} to User PATH (reopen terminals to use bun / petdex)`,
    );
  } else if (r.status === 0 && out === "PRESENT") {
    ok("PATH", "~/.bun/bin + ~/.petdex/bin already in User PATH");
  } else {
    fail("PATH", `could not persist PATH: ${r.stderr.trim() || out}`);
  }
}

function bunCmd(): string {
  // Always return an absolute path so spawnSync (no shell) can find it.
  const candidate = join(
    HOME,
    ".bun",
    "bin",
    process.platform === "win32" ? "bun.exe" : "bun",
  );
  if (existsSync(candidate)) return candidate;
  // Last resort: bare name (works if PATH has it).
  return "bun";
}

// ── 1. Build CLI + sidecar ────────────────────────────────────────────
function stepBuild(): void {
  log("\n[2/5] Build petdex CLI + sidecar");
  const bun = bunCmd();
  const cli = run(bun, ["run", "build"], {
    cwd: join(REPO, "packages", "petdex-cli"),
  });
  if (
    cli.status === 0 &&
    existsSync(join(REPO, "packages", "petdex-cli", "dist", "petdex.js"))
  ) {
    ok("petdex CLI", "dist/petdex.js");
  } else {
    fail("petdex CLI build", cli.stderr.trim() || "see output above");
  }

  const sidecar = run(bun, ["run", "build"], {
    cwd: join(REPO, "packages", "petdex-desktop", "sidecar"),
  });
  if (
    sidecar.status === 0 &&
    existsSync(join(REPO, "packages", "petdex-desktop", "sidecar", "server.js"))
  ) {
    ok("sidecar", "server.js");
  } else {
    fail("sidecar build", sidecar.stderr.trim() || "see output above");
  }
}

// ── 2. Stage runtime files ────────────────────────────────────────────
function stepStage(): void {
  log("\n[3/5] Stage runtime files (~/.petdex)");
  mkdirSync(BIN_DIR, { recursive: true });
  mkdirSync(SIDECAR_DIR, { recursive: true });

  // Sidecar -> ~/.petdex/sidecar/server.js (where the Tauri loader looks).
  const sidecarSrc = join(
    REPO,
    "packages",
    "petdex-desktop",
    "sidecar",
    "server.js",
  );
  const sidecarDst = join(SIDECAR_DIR, "server.js");
  if (existsSync(sidecarSrc)) {
    try {
      writeFileSync(sidecarDst, readFileSync(sidecarSrc));
      ok("sidecar staged", "~/.petdex/sidecar/server.js");
    } catch (e) {
      fail("stage sidecar", (e as Error).message);
    }
  } else {
    fail("stage sidecar", "build it first (run the script again)");
  }

  // Desktop exe -> ~/.petdex/bin/petdex-desktop-win32-x64.exe (CLI's expected asset).
  const exeName =
    process.platform === "win32"
      ? "petdex-desktop-win32-x64.exe"
      : "petdex-desktop-darwin-x64";
  const exeSrc = join(
    REPO,
    "packages",
    "petdex-desktop-windows",
    "src-tauri",
    "target",
    "release",
    exeName,
  );
  const exeDst = join(BIN_DIR, exeName);
  if (existsSync(exeSrc)) {
    try {
      writeFileSync(exeDst, readFileSync(exeSrc));
      ok("desktop exe staged", `~/.petdex/bin/${exeName}`);
    } catch (e) {
      // EBUSY: the exe is locked (a desktop instance is still running). The
      // existing copy is fine — treat as ok so re-running setup while the pet
      // is visible doesn't show a spurious failure.
      const msg = (e as Error).message;
      if (existsSync(exeDst) && /EBUSY|EPERM|busy|locked/i.test(msg)) {
        ok(
          "desktop exe staged",
          `~/.petdex/bin/${exeName} (already present; in use)`,
        );
      } else {
        fail("stage desktop exe", msg);
      }
    }
  } else {
    fail(
      "stage desktop exe",
      "not built \u2014 run: cargo build --release in src-tauri (or skip if you only want hooks)",
    );
  }

  // On Windows, drop a `petdex.cmd` shim next to the binary so the user can
  // run `petdex doctor` / `petdex install <slug>` from any terminal without
  // needing a separate node install — bun runs the CLI. The shim resolves
  // bun via PATH then the well-known install location as a fallback.
  if (process.platform === "win32") {
    const bunExe = join(HOME, ".bun", "bin", "bun.exe").replace(/\\/g, "\\");
    // %~dp0 resolves to the .cmd's own directory at runtime, so the shim
    // finds petdex.js sitting next to it without an absolute path.
    const shim = `@echo off\r\nsetlocal\r\nwhere bun >nul 2>nul && (bun "%~dp0petdex.js" %*) || (if exist "${bunExe}" ("${bunExe}" "%~dp0petdex.js" %*) else (echo petdex: bun not found. Install from bun.sh & exit /b 1))\r\n`;
    const shimPath = join(BIN_DIR, "petdex.cmd");
    try {
      writeFileSync(shimPath, shim);
      ok(
        "petdex shim",
        "~/.petdex/bin/petdex.cmd (run `petdex ...` from any terminal)",
      );
    } catch (e) {
      fail("petdex shim", (e as Error).message);
    }
  }
}

// ── 3. Starter pet (so the overlay renders on first launch) ───────────
async function stepStarterPet(): Promise<void> {
  log("\n[3.5/5] Starter pet");
  const petsRoot = join(PETDEX_DIR, "pets");
  // If a pet with a real (non-empty) spritesheet is already installed, done.
  // Checking for the sprite (not just the dir) catches a half-written fallback
  // from a prior run where the atlas generation failed and left only pet.json.
  const hasUsablePet = (dir: string): boolean => {
    try {
      const { readdirSync, statSync } = require("node:fs") as {
        readdirSync: (p: string) => string[];
        statSync: (p: string) => { size: number };
      };
      for (const slug of readdirSync(dir)) {
        for (const sprite of ["spritesheet.webp", "spritesheet.png"]) {
          const sp = join(dir, slug, sprite);
          if (existsSync(sp) && statSync(sp).size > 0) return true;
        }
      }
    } catch {}
    return false;
  };
  if (existsSync(petsRoot) && hasUsablePet(petsRoot)) {
    ok("starter pet", "already installed");
    return;
  }
  // Try the CLI's install (hits the live petdex.dev manifest). Use bun (not
  // node) to run the CLI, since node isn't guaranteed on the host.
  const cliJs = join(REPO, "packages", "petdex-cli", "dist", "petdex.js");
  if (existsSync(cliJs)) {
    const r = spawnSync(bunCmd(), [cliJs, "install", "default"], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        PETDEX_URL: process.env.PETDEX_URL ?? "https://petdex.dev",
      },
    });
    if (r.status === 0) {
      ok("starter pet", "default (from registry)");
      return;
    }
  }
  // Fallback: generate a real (transparent) 1536x1872 atlas so the overlay
  // renders an empty-but-valid pet instead of crashing on a missing sprite.
  // The user should install a real pet via `petdex install <slug>` or
  // generate one with --generate.
  const fallbackSlug = "starter";
  const fallbackDir = join(petsRoot, fallbackSlug);
  mkdirSync(fallbackDir, { recursive: true });
  try {
    const sharp = (await import("sharp")).default;
    const atlas = await sharp({
      create: {
        width: 1536,
        height: 1872,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .webp({ lossless: true })
      .toBuffer();
    writeFileSync(join(fallbackDir, "spritesheet.webp"), atlas);
    writeFileSync(
      join(fallbackDir, "pet.json"),
      JSON.stringify(
        {
          id: fallbackSlug,
          displayName: "Starter",
          description:
            "Placeholder pet. Install a real one: petdex install <slug>",
          spritesheetPath: "spritesheet.webp",
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(PETDEX_DIR, "active.json"),
      JSON.stringify({ slug: fallbackSlug }),
    );
    fail(
      "starter pet",
      "registry unreachable \u2014 wrote transparent placeholder. Install a real one: petdex install <slug>",
    );
  } catch (e) {
    fail("starter pet", `placeholder failed: ${(e as Error).message}`);
  }
}

// ── 4. ZCode hooks ────────────────────────────────────────────────────
function stepZcodeHooks(): void {
  log("\n[4/5] Install ZCode hooks");
  // Persist the CLI binary first (hooks invoke ~/.petdex/bin/petdex.js).
  const cliJs = join(REPO, "packages", "petdex-cli", "dist", "petdex.js");
  const persistDir = BIN_DIR;
  const persistDst = join(persistDir, "petdex.js");
  mkdirSync(persistDir, { recursive: true });
  if (existsSync(cliJs)) {
    try {
      writeFileSync(persistDst, readFileSync(cliJs));
      ok("persisted CLI", "~/.petdex/bin/petdex.js");
    } catch (e) {
      fail("persist CLI", (e as Error).message);
      return;
    }
  } else {
    fail("persist CLI", "dist/petdex.js missing");
    return;
  }

  // Write the ZCode config directly. The exact shape mirrors agents.ts
  // bubbleProcessHook(): hooks.enabled + hooks.events.<Event> nesting +
  // type:"process" argv. Writing it inline avoids importing the TS source
  // (the built CLI bundle doesn't export the registry).
  const persistPath = persistDst.replace(/\\/g, "/");
  const bubble = (phase: string, state: string, dur?: number) => {
    const args = [persistPath, "bubble", phase, "zcode", state];
    if (dur != null) args.push(String(dur));
    return {
      type: "process" as const,
      command: "node",
      args,
      timeoutMs: 60000,
    };
  };
  const config = {
    hooks: {
      enabled: true,
      events: {
        SessionStart: [{ hooks: [bubble("user-prompt", "jumping", 800)] }],
        UserPromptSubmit: [{ hooks: [bubble("user-prompt", "jumping", 800)] }],
        PreToolUse: [{ hooks: [bubble("pre", "running")] }],
        PostToolUse: [{ hooks: [bubble("post", "idle")] }],
        PostToolUseFailure: [{ hooks: [bubble("error", "failed")] }],
        PermissionRequest: [{ hooks: [bubble("waiting", "waiting")] }],
        Stop: [{ hooks: [bubble("stop", "waving", 1500)] }],
      },
    },
  };
  const cfgPath = join(HOME, ".zcode", "cli", "config.json");
  try {
    mkdirSync(join(HOME, ".zcode", "cli"), { recursive: true });
    writeFileSync(cfgPath, `${JSON.stringify(config, null, 2)}\n`);
    // Also drop the /petdex slash command (the killswitch shortcut) so
    // `petdex doctor` reports fully installed. Plain markdown; harmless if
    // the running ZCode build reads commands from elsewhere.
    const cmdDir = join(HOME, ".zcode", "commands");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(join(cmdDir, "petdex.md"), ZCODE_SLASH_CMD);
    ok("ZCode hooks", "~/.zcode/cli/config.json + /petdex command");
  } catch (e) {
    fail("ZCode hooks", (e as Error).message);
  }
}

// Body of the /petdex slash command for ZCode. Mirrors slash-command.ts's
// SLASH_COMMAND_BODY but invokes the persisted CLI via bun (no node dep).
const ZCODE_SLASH_CMD = `---
description: Wake or sleep the petdex mascot. Toggles the floating pet on/off
---

Run the matching command using the persisted petdex binary (always present after \`petdex hooks install\`):

- \`/petdex\` (no args) -> run \`petdex toggle\`
- \`/petdex up\` -> run \`petdex up\`
- \`/petdex down\` -> run \`petdex down\`
- \`/petdex status\` -> run \`petdex hooks status\`
- \`/petdex doctor\` -> run \`petdex doctor\`

Show the command output verbatim. Don't reinterpret.

Arguments: \`$ARGUMENTS\`
`;

// ── 4. OpenRouter key ─────────────────────────────────────────────────
function stepKey(): void {
  log("\n[5/5] OpenRouter API key");
  // Try .env.local first (user-friendly), then the process env.
  const envLocal = join(REPO, ".env.local");
  let key = process.env.OPENROUTER_API_KEY ?? "";
  if (!key && existsSync(envLocal)) {
    const text = readFileSync(envLocal, "utf8");
    const m = text.match(/^OPENROUTER_API_KEY\s*=\s*["']?([^\s"']+)["']?\s*$/m);
    if (m) key = m[1] ?? "";
  }
  if (!key) {
    fail(
      "OpenRouter key",
      "not set. Put OPENROUTER_API_KEY=sk-... in .env.local and re-run.",
    );
    return;
  }
  const runtimeDir = join(PETDEX_DIR, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const keyPath = join(runtimeDir, "openrouter-key");
  try {
    writeFileSync(keyPath, key.trim());
    // Owner-only ACL (best-effort). gpt-image-2 is mandatory, ~$0.40/pet.
    // SECURITY: use spawnSync with argv (shell:false) — never execSync with
    // a string, which would let a crafted USERNAME (containing `"` or `&`)
    // inject shell metacharacters. Validate the username against a strict
    // shape before handing it to icacls.
    if (process.platform === "win32") {
      const user = process.env.USERNAME ?? process.env.USER ?? "";
      if (user && /^[A-Za-z0-9_\-.\\]+$/.test(user)) {
        spawnSync(
          "icacls",
          [keyPath, "/inheritance:r", "/grant:r", `${user}:F`],
          { stdio: "ignore", shell: false },
        );
      } else {
        fail(
          "owner-only ACL",
          `untrusted USERNAME "${user}" — key file left with default ACL`,
        );
      }
    } else {
      spawnSync("chmod", ["600", keyPath], { stdio: "ignore", shell: false });
    }
    ok("OpenRouter key", "~/.petdex/runtime/openrouter-key (owner-only)");
  } catch (e) {
    fail("write key", (e as Error).message);
  }
}

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  log("================ petdex Windows setup ================");
  const bunOk = stepBun();
  if (!bunOk) {
    log("\nFix Bun first, then re-run.");
    process.exit(1);
  }
  stepBuild();
  stepStage();
  stepPersistPath(); // after stage so ~/.petdex/bin exists
  await stepStarterPet();
  stepZcodeHooks();
  stepKey();

  const failed = steps.filter((s) => !s.ok);
  log("\n================ summary ================");
  log(`  ${steps.length - failed.length}/${steps.length} steps ok`);
  if (failed.length === 0) {
    log("\n  All good. Next:");
    log("    bun scripts/run-desktop.ts            (launch the overlay)");
    log(
      "    bun scripts/run-desktop.ts --generate  (generate a pet via gpt-image-2)",
    );
  } else {
    log("\n  Some steps failed:");
    for (const s of failed)
      log(`    - ${s.label}${s.detail ? `: ${s.detail}` : ""}`);
  }
  log("");
}

main();
