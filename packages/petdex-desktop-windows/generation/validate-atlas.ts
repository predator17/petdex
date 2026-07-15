/**
 * validate-atlas: the quality gate that runs BEFORE a generated pet is
 * written to ~/.petdex/pets/. Ported from hatch-pet's validate_atlas.py
 * (plan §5.2 phase 5, §5.8).
 *
 * Two invariants:
 *   1. Grid shape: the atlas must be the classic 8×9 (1536×1872) or a
 *      clean scale, matching the web validator
 *      (submissions-validation.ts:80-92) so the sprite viewer renders it
 *      without misalignment.
 *   2. Transparency: transparent pixels (alpha < threshold) must carry
 *      no RGB residue. Residual color under low alpha produces halos
 *      when composited — the single most common visible defect. The
 *      chroma-key step zeros RGB at alpha=0, but a failed/regressed key
 *      would leak fringe pixels; this check catches that before write.
 */
import sharp from "sharp";

import { ATLAS_HEIGHT, ATLAS_WIDTH } from "./pet-contract.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** Pixel dimensions of the atlas. */
  width: number;
  height: number;
  /** Count of pixels that violated the transparency invariant. */
  residuePixels: number;
}

/** Alpha below this is treated as "transparent" for the residue check. */
const ALPHA_THRESHOLD = 16;

/**
 * Validate a composed atlas buffer. Returns a structured result so the
 * caller can surface specific failures to the UI (plan §5.7 #5: "reject
 * any generated asset that fails the atlas-grid check and the
 * transparency-invariant check before writing").
 */
export async function validateAtlas(atlas: Buffer): Promise<ValidationResult> {
  const errors: string[] = [];
  const meta = await sharp(atlas).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (width === 0 || height === 0) {
    return {
      ok: false,
      errors: ["atlas has no decodeable dimensions"],
      width,
      height,
      residuePixels: 0,
    };
  }

  // Grid invariant: classic 8×9 ratio (1536:1872) or a clean integer
  // scale. Mirrors submissions-validation.ts isClassicGrid check.
  const isClassicGrid = width * ATLAS_HEIGHT === height * ATLAS_WIDTH;
  if (!isClassicGrid) {
    errors.push(
      `atlas is ${width}x${height}, expected the 8x9 classic grid ratio (1536x1872 or a clean scale). The sprite viewer would misalign every frame.`,
    );
  }

  // Transparency invariant: scan raw RGBA for pixels where alpha is below
  // threshold but RGB is non-zero (residue). A clean chroma key leaves
  // 0,0,0,0 at background pixels; residue means the key leaked.
  const raw: Buffer = await sharp(atlas).ensureAlpha().raw().toBuffer();
  let residuePixels = 0;
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const a = raw[i + 3];
    if (a < ALPHA_THRESHOLD && (r !== 0 || g !== 0 || b !== 0)) {
      residuePixels += 1;
    }
  }
  // Allow a tiny residue count for anti-alias edge pixels that land just
  // under threshold — but a count in the thousands means a broken key.
  const RESIDUE_TOLERANCE = Math.round((width * height) / 10000); // 0.01%
  if (residuePixels > RESIDUE_TOLERANCE) {
    errors.push(
      `transparency invariant failed: ${residuePixels} pixels have RGB residue under low alpha (max ${RESIDUE_TOLERANCE}). The chroma key leaked — re-key or regenerate this row.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    width,
    height,
    residuePixels,
  };
}
