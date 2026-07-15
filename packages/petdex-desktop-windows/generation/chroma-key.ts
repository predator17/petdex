/**
 * Chroma-key: remove the flat chroma background gpt-image-2 renders on
 * and replace it with true per-pixel alpha. This is the critical-path
 * substitute for native transparency, which gpt-image-2 cannot emit
 * (plan §2.5: background is ["auto","opaque"] only).
 *
 * The model is prompted to render on a specific flat color
 * (CHROMA_KEY_COLOR, default #00FF00) with no gradients/shadows on the
 * background. We then key out that color with a small tolerance band so
 * anti-aliased sprite edges transition cleanly to transparent rather than
 * leaving a green fringe.
 *
 * Implementation uses sharp's raw pixel access (RGB→RGBA via the compositing
 * pipeline). The transparency invariant (validate-atlas.ts) later asserts
 * that transparent pixels carry no RGB residue, which is what produces
 * clean compositing without halos.
 */
import sharp from "sharp";

import { CHROMA_KEY_COLOR } from "./pet-contract.js";

export interface ChromaKeyOptions {
  /**
   * Max Euclidean distance in RGB space from the chroma color at which a
   * pixel is considered "background". Pixels within `feather` beyond this
   * are partially transparent (anti-alias fringe). Defaults tuned for a
   * pure #00FF00 key against typical sprite palettes.
   */
  tolerance?: number;
  /** Width of the alpha-feather band beyond `tolerance` (0..1 alpha ramp). */
  feather?: number;
}

const DEFAULT_TOLERANCE = 80; // ~0.31 of the 0-255 channel range
const DEFAULT_FEATHER = 60;

/**
 * Key out the chroma background of a PNG/WEBP buffer, returning a PNG with
 * per-pixel alpha. The output has a premultiplied-clean alpha channel so
 * downstream compositing (compose-atlas) doesn't produce green halos.
 */
export async function chromaKey(
  input: Buffer,
  options: ChromaKeyOptions = {},
): Promise<Buffer> {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const feather = options.feather ?? DEFAULT_FEATHER;
  const { r: kr, g: kg, b: kb } = CHROMA_KEY_COLOR;

  // Flatten to RGBA raw pixels. We force 4 channels so the alpha math is
  // uniform regardless of the input's source channels.
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error("chromaKey: input image has no dimensions");
  }

  const raw: Buffer = await sharp(input).ensureAlpha().raw().toBuffer();

  // raw is width*height*4 bytes: [R,G,B,A, R,G,B,A, ...]
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];

    // Euclidean distance from the chroma key color.
    const dr = r - kr;
    const dg = g - kg;
    const db = b - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    if (dist <= tolerance) {
      // Fully background → fully transparent. Zero the RGB so the
      // transparency invariant (no residue) holds for these pixels.
      raw[i] = 0;
      raw[i + 1] = 0;
      raw[i + 2] = 0;
      raw[i + 3] = 0;
    } else if (dist <= tolerance + feather) {
      // Fringe band → partial alpha ramp (anti-aliased edges).
      const t = (dist - tolerance) / feather; // 0..1
      raw[i + 3] = Math.round(t * 255);
      // Scale RGB toward full intensity by 1/t so premultiplied
      // compositing keeps the edge color correct at partial alpha.
      // (Avoids the dark fringe from straight-alpha over-darkening.)
      if (t > 0) {
        raw[i] = Math.min(255, Math.round(r / t));
        raw[i + 1] = Math.min(255, Math.round(g / t));
        raw[i + 2] = Math.min(255, Math.round(b / t));
      }
    }
    // dist > tolerance + feather → keep original alpha (likely 255).
  }

  // Re-encode the keyed raw buffer back to PNG (lossless, keeps alpha).
  return sharp(raw, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * Convenience: key a buffer and report whether ANY background pixels were
 * found. A strip with zero keyed pixels likely wasn't rendered on the
 * expected chroma background (prompt discipline slipped), which is a
 * useful signal for the QA step.
 */
export async function chromaKeyWithStats(
  input: Buffer,
  options?: ChromaKeyOptions,
): Promise<{ output: Buffer; keyedPixels: number; totalPixels: number }> {
  const tolerance = options?.tolerance ?? DEFAULT_TOLERANCE;
  const { r: kr, g: kg, b: kb } = CHROMA_KEY_COLOR;
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const raw: Buffer = await sharp(input).ensureAlpha().raw().toBuffer();

  let keyed = 0;
  for (let i = 0; i < raw.length; i += 4) {
    const dr = raw[i] - kr;
    const dg = raw[i + 1] - kg;
    const db = raw[i + 2] - kb;
    if (Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance) keyed += 1;
  }

  const output = await chromaKey(input, options);
  return {
    output,
    keyedPixels: keyed,
    totalPixels: width * height,
  };
}
