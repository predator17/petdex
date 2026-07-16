/**
 * scripts/run-desktop.ts — launch the Windows desktop pet overlay, and
 * optionally generate a new pet via gpt-image-2 (Workstream C).
 *
 * Usage (from the repo root, in cmd / PowerShell / Git Bash):
 *
 *   bun scripts/run-desktop.ts              Launch the floating overlay.
 *   bun scripts/run-desktop.ts --generate   Generate a pet first, then launch.
 *
 * `--generate` needs OPENROUTER_API_KEY in .env.local (written there by
 * setup-windows.ts, or set manually). It calls the sidecar's POST /generate
 * with the mandatory cost-confirmation flag, so a real ~$0.40 charge posts
 * to your OpenRouter account. The desktop then loads the freshly generated
 * pet from ~/.petdex/pets/<id>/.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(
  dirname(
    new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    "..",
  ),
);
const HOME = homedir();
const PETDEX_DIR = join(HOME, ".petdex");
const BIN_DIR = join(PETDEX_DIR, "bin");
const SIDECAR_DIR = join(PETDEX_DIR, "sidecar");
const RUNTIME_DIR = join(PETDEX_DIR, "runtime");

const args = process.argv.slice(2);
const wantGenerate = args.includes("--generate") || args.includes("generate");

function readEnvKey(): string {
  // .env.local first, then process env.
  const envLocal = join(REPO, ".env.local");
  let key = process.env.OPENROUTER_API_KEY ?? "";
  if (!key && existsSync(envLocal)) {
    const text = readFileSync(envLocal, "utf8");
    const m = text.match(/^OPENROUTER_API_KEY\s*=\s*["']?([^\s"']+)["']?\s*$/m);
    if (m) key = m[1] ?? "";
  }
  return key;
}

function ensureKey(): string | null {
  let key = readEnvKey();
  // Also accept a key already staged at the runtime store.
  const keyPath = join(RUNTIME_DIR, "openrouter-key");
  if (!key && existsSync(keyPath)) key = readFileSync(keyPath, "utf8").trim();
  if (!key) {
    console.log("\u2717 No OPENROUTER_API_KEY found.");
    console.log("  Put OPENROUTER_API_KEY=sk-... in .env.local, then re-run,");
    console.log("  or run: bun scripts/setup-windows.ts");
    return null;
  }
  // Make sure the runtime store has it (the sidecar reads from there).
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(keyPath, key.trim());
  return key;
}

async function generatePet(): Promise<string | null> {
  console.log("\n=== Pet generation (gpt-image-2, ~$0.40) ===");
  const key = ensureKey();
  if (!key) return null;

  const slug = (process.env.PETDEX_PET_ID || "my-pet").trim();
  const name = process.env.PETDEX_PET_NAME || "My Pet";
  const desc =
    process.env.PETDEX_PET_DESC ||
    "a cute round blob creature with big eyes, soft pastel colors";
  console.log(`  name: ${name}`);
  console.log(`  id:   ${slug}`);
  console.log(`  desc: ${desc}`);
  console.log(
    "  (set PETDEX_PET_NAME / PETDEX_PET_ID / PETDEX_PET_DESC to customize)\n",
  );

  // Run the pipeline DIRECTLY (not via the sidecar). The generation modules
  // need `sharp`, whose native .node binary is resolvable from the repo's
  // node_modules — but NOT from the bare ~/.petdex/sidecar/ deploy location.
  // Running here (repo root, under bun) keeps sharp working and avoids the
  // sidecar's bundled-sharp crash. The pipeline writes the pet to
  // ~/.petdex/pets/<slug>/ and we then launch sidecar+desktop to display it.
  console.log("  generating (this takes ~2-4 min for 10 images)...");
  try {
    const { generatePet: runPipeline } = await import(
      "../packages/petdex-desktop-windows/generation/generate-pet.ts"
    );
    const result = await runPipeline(
      {
        id: slug,
        displayName: name,
        description: desc,
        apiKey: key,
      },
      // Surface per-step progress so the long generation isn't a silent wait.
      (p) => {
        if (p.phase === "error") console.log(`  \u2717 ${p.message}`);
        else console.log(`  \u2022 ${p.message}`);
      },
    );
    if (!result.ok) {
      console.log(`\u2717 Generation failed: ${result.error}`);
      return null;
    }
    console.log(`\u2713 Pet generated at ${result.petDir}`);
    return slug;
  } catch (e) {
    console.log(`\u2717 Pipeline error: ${(e as Error).message}`);
    return null;
  }
}

function launchDesktop(): void {
  console.log("\n=== Launch desktop overlay ===");
  const exeName =
    process.platform === "win32"
      ? "petdex-desktop-win32-x64.exe"
      : "petdex-desktop-darwin-x64";
  const exe = join(BIN_DIR, exeName);
  if (!existsSync(exe)) {
    console.log(`\u2717 Desktop exe not found at ${exe}`);
    console.log("  Run: bun scripts/setup-windows.ts");
    process.exit(1);
  }
  const sidecarJs = join(SIDECAR_DIR, "server.js");
  if (!existsSync(sidecarJs)) {
    console.log(`\u2717 Sidecar not staged at ${sidecarJs}`);
    console.log("  Run: bun scripts/setup-windows.ts");
    process.exit(1);
  }
  console.log(`  launching ${exe}`);
  console.log(
    "  (the overlay floats on top. Shift+click = picker, middle-click = settings, right-click = quit)",
  );
  // Detach so the overlay survives this script exiting.
  const child = spawn(exe, [], {
    stdio: "ignore",
    detached: true,
    shell: false,
  });
  child.unref();
  console.log(
    `\u2713 Desktop launched (pid ${child.pid}). This script will exit; the pet keeps running.`,
  );
}

async function main() {
  console.log("================ petdex run-desktop ================");
  if (wantGenerate) {
    const slug = await generatePet();
    if (!slug) {
      console.log("\nGeneration failed; not launching desktop.");
      process.exit(1);
    }
    // Mark it active so the overlay loads it.
    mkdirSync(PETDEX_DIR, { recursive: true });
    writeFileSync(join(PETDEX_DIR, "active.json"), JSON.stringify({ slug }));
    console.log(`  set active pet: ${slug}`);
  }
  launchDesktop();
}

main();
