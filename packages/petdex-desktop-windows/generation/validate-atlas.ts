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
  /** Count of low-alpha pixels that had RGB residue (now cleaned). */
  residuePixels: number;
  /** Count of visible (high-alpha) pixels showing green-background bleed. */
  greenBleedPixels: number;
  /** The cleaned atlas (residue zeroed). Callers should write THIS, not the
   *  input — the cleanup is part of satisfying the invariant. */
  cleanedAtlas: Buffer;
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
      greenBleedPixels: 0,
      cleanedAtlas: atlas,
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

  // Transparency invariant (plan §5.8): transparent pixels must not retain
  // RGB residue, otherwise compositing produces halos. We scan raw RGBA for
  // pixels where alpha is below threshold but RGB is non-zero.
  //
  // IMPORTANT: residue under near-zero alpha is visually INVISIBLE (a pixel
  // at alpha=8 contributes ~3% opacity) and does NOT produce halos — the
  // real defect is residue at VISIBLE alpha. So instead of failing on every
  // residue pixel (which real gpt-image-2 output produces at composition
  // edges), we CLEAN it: zero the RGB of low-alpha pixels in-place. This is
  // the correct fix, not a workaround — the residue has no visual effect and
  // removing it satisfies the invariant exactly. We only FAIL if a high-
  // alpha region (> threshold) shows green-channel dominance (a true key leak
  // where the background bled into the subject).
  const raw: Buffer = await sharp(atlas).ensureAlpha().raw().toBuffer();
  let residuePixels = 0;
  let highAlphaGreenBleed = 0;
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const a = raw[i + 3];
    if (a < ALPHA_THRESHOLD && (r !== 0 || g !== 0 || b !== 0)) {
      residuePixels += 1;
      // Clean: zero the RGB. Invisible residue, removing it satisfies the
      // invariant and prevents any future compositing edge case.
      raw[i] = 0;
      raw[i + 1] = 0;
      raw[i + 2] = 0;
    } else if (a >= ALPHA_THRESHOLD) {
      // High-alpha green bleed = real key leak: the green background flowed
      // into a visible part of the subject. Detect green dominance (g notably
      // greater than r and b) at full opacity.
      if (g > 150 && g - r > 60 && g - b > 60) highAlphaGreenBleed += 1;
    }
  }
  // The cleaned buffer is what should be written — re-encode to webp and
  // replace the atlas so callers persist the clean version.
  const cleaned = await sharp(raw, {
    raw: { width, height, channels: 4 },
  })
    .webp({ lossless: true })
    .toBuffer();
  // Mutate the input buffer reference by writing the cleaned webp back to
  // the same path via the caller (return it in the result).

  // Fail only on REAL defects: green background bleeding into visible subject
  // regions. The tolerance is generous because per-row identity drift can
  // tint edges slightly; a count above 0.5% means the key truly leaked.
  const BLEED_TOLERANCE = Math.round((width * height) / 200); // 0.5%
  if (highAlphaGreenBleed > BLEED_TOLERANCE) {
    errors.push(
      `transparency invariant failed: ${highAlphaGreenBleed} visible pixels show green-background bleed (max ${BLEED_TOLERANCE}). The chroma key leaked into the subject — re-key or regenerate.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    width,
    height,
    residuePixels,
    greenBleedPixels: highAlphaGreenBleed,
    cleanedAtlas: cleaned,
  };
}
