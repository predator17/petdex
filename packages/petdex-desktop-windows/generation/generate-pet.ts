/**
 * generate-pet: the orchestrator that runs the full hatch-pet pipeline
 * locally. Ties together: imagegen (gpt-image-2) → extract-strip-frames
 * → chroma-key → compose-atlas → validate-atlas → write pet.
 *
 * This is the deterministic reimplementation of hatch-pet's workflow
 * (plan §5.2) minus the human QA loop — the validate-atlas transparency
 * invariant is the automated gate that replaces the visual QA worker.
 *
 * Output: ~/.petdex/pets/<id>/spritesheet.webp + pet.json (plan §5.3).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { composeAtlas } from "./compose-atlas.js";
import { extractStripFrames } from "./extract-strip-frames.js";
import { generateImage } from "./imagegen.js";
import {
  PETGEN_MODEL,
  type PetJson,
  ROWS,
  TOTAL_IMAGES_PER_PET,
} from "./pet-contract.js";
import { allPrompts } from "./prompts.js";
import { validateAtlas } from "./validate-atlas.js";

export interface GeneratePetParams {
  /** The user's pet description (sanitized upstream — plan §5.7 #4). */
  description: string;
  displayName: string;
  /** Optional slug; derived from displayName if omitted. */
  id?: string;
  style?: string;
  /** OpenRouter API key (local only — never sent to the backend). */
  apiKey: string;
  /** Max retries per row on a failed validate. Default 1 (plan §5.9). */
  maxRetriesPerRow?: number;
}

export interface GeneratePetProgress {
  phase: "base" | "row" | "compose" | "validate" | "done" | "error";
  row?: number;
  state?: string;
  message: string;
}

export interface GeneratePetResult {
  ok: boolean;
  petDir: string;
  error?: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "pet"
  );
}

/** Convert a generated base image buffer to a data URL for identity lock. */
function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Run the full pet-generation pipeline. Emits progress via the callback so
 * the UI can show "generating base…", "row 3/9: waving…", etc.
 *
 * SECURITY: the apiKey stays local. Generation is offline except for the
 * OpenRouter calls; no petdex backend is contacted.
 */
export async function generatePet(
  params: GeneratePetParams,
  onProgress?: (p: GeneratePetProgress) => void,
): Promise<GeneratePetResult> {
  const id = params.id ?? slugify(params.displayName);
  const maxRetries = params.maxRetriesPerRow ?? 1;
  const petDir = path.join(homedir(), ".petdex", "pets", id);

  const prompts = allPrompts({
    description: params.description,
    style: params.style,
  });

  try {
    // Index row prompts by row for O(1) lookup in the loop below (avoids
    // a per-iteration .find() and the non-null assertion it would need).
    const promptByRow = new Map(
      prompts.rows.map((r) => [r.spec.row, r.prompt]),
    );

    // ── Phase 1: canonical base (identity-lock reference) ──────────
    onProgress?.({
      phase: "base",
      message: `Generating base portrait (${PETGEN_MODEL})…`,
    });
    const baseResult = await generateImage({
      apiKey: params.apiKey,
      prompt: prompts.base,
    });
    const referenceUrl = toDataUrl(baseResult.image);

    // ── Phase 2: per-row strips (identity-locked via reference) ─────
    const rowFrames = [];
    for (const spec of ROWS) {
      onProgress?.({
        phase: "row",
        row: spec.row,
        state: spec.state,
        message: `Generating row ${spec.row + 1}/${ROWS.length}: ${spec.state}…`,
      });

      let frames: Buffer[] | null = null;
      let lastError: string | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const stripResult = await generateImage({
            apiKey: params.apiKey,
            prompt: promptByRow.get(spec.row) ?? "",
            referenceDataUrl: referenceUrl,
          });
          const extracted = await extractStripFrames(
            stripResult.image,
            spec.columns,
          );
          frames = extracted.map((f) => f.buffer);
          break;
        } catch (err) {
          lastError = (err as Error).message;
        }
      }
      if (!frames) {
        throw new Error(
          `Row ${spec.state} failed after ${maxRetries + 1} attempt(s): ${lastError}`,
        );
      }
      rowFrames.push({ row: spec.row, frames });
    }

    // ── Phase 3: compose the atlas ─────────────────────────────────
    onProgress?.({ phase: "compose", message: "Composing 8×9 atlas…" });
    const atlas = await composeAtlas(rowFrames);

    // ── Phase 4: validate (transparency invariant + grid) ──────────
    onProgress?.({
      phase: "validate",
      message: "Validating transparency invariant…",
    });
    const validation = await validateAtlas(atlas);
    if (!validation.ok) {
      // Plan §5.7 #5: reject before write. A malformed local pet would
      // crash the Tauri renderer on next load.
      onProgress?.({
        phase: "error",
        message: `Validation failed: ${validation.errors.join("; ")}`,
      });
      return {
        ok: false,
        petDir,
        error: `Atlas validation failed: ${validation.errors.join("; ")}`,
      };
    }

    // ── Phase 5: write to ~/.petdex/pets/<id>/ ─────────────────────
    onProgress?.({ phase: "done", message: `Writing pet to ${petDir}…` });
    await mkdir(petDir, { recursive: true });
    await writeFile(path.join(petDir, "spritesheet.webp"), atlas);
    const petJson: PetJson = {
      id,
      displayName: params.displayName,
      description: params.description.slice(0, 120),
      spritesheetPath: "spritesheet.webp",
    };
    await writeFile(
      path.join(petDir, "pet.json"),
      `${JSON.stringify(petJson, null, 2)}\n`,
      "utf8",
    );

    onProgress?.({
      phase: "done",
      message: `Pet "${params.displayName}" ready at ${petDir}`,
    });
    return { ok: true, petDir };
  } catch (err) {
    const message = (err as Error).message;
    onProgress?.({ phase: "error", message });
    return { ok: false, petDir, error: message };
  }
}

export { TOTAL_IMAGES_PER_PET };
