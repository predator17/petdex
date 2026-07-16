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

/**
 * Reserved for future tuning. The current implementation uses green-dominance
 * classification (constants above) which adapts to the subject color, so
 * tolerance/feather are no longer needed — kept in the type for API stability.
 */
export interface ChromaKeyOptions {
  tolerance?: number;
  feather?: number;
}

// Tuned against real gpt-image-2 output on a #00FF00 prompt. A pure RGB-
// distance tolerance can't cleanly separate the green background from a
// warm-colored (orange/yellow) subject: the model's green-noise band
// (180-300 distance) OVERLAPS the subject (264-306). So we key on GREEN
// DOMINANCE — a pixel is background if G is the max channel AND notably
// exceeds R and B. This keeps warm subjects (R-dominant) fully intact while
// removing green noise, regardless of distance. A tight distance band
// handles the pure-background core for speed.
const GREEN_DOMINANCE_MARGIN = 25; // G must exceed R and B by this much
const PURE_BG_DISTANCE = 120; // within this of #00FF00 → definitely bg
const FEATHER_BAND = 40; // smooth the dominance-key boundary
// Pixels whose feather-band alpha lands below this floor are zeroed fully
// (RGB + alpha) so the validator's transparency invariant (no RGB residue
// under low alpha, §5.8) holds. Must match validate-atlas.ts ALPHA_THRESHOLD.
const RESIDUE_ALPHA_FLOOR = 16;

/**
 * Key out the chroma background of a PNG/WEBP buffer, returning a PNG with
 * per-pixel alpha. The output has a premultiplied-clean alpha channel so
 * downstream compositing (compose-atlas) doesn't produce green halos.
 */
export async function chromaKey(
  input: Buffer,
  _options?: ChromaKeyOptions,
): Promise<Buffer> {
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
  //
  // GREEN-DOMINANCE KEY: classify each pixel as background if green is the
  // dominant channel (G > R and G > B by a margin). This correctly separates
  // green noise from warm-colored subjects that pure-distance can't (an
  // orange pixel at 255,180,50 and a green-noise pixel at 90,200,80 are at
  // similar distance from #00FF00, but only the latter has G dominant).
  // The dominance margin ramps near the boundary for anti-aliased edges.
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];

    // Distance from pure green — used for the pure-background core only.
    const dr = r - kr;
    const dg = g - kg;
    const db = b - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    // Green dominance: how much G exceeds both R and B. Positive = bg.
    const dominance = Math.min(g - r, g - b);

    if (dist <= PURE_BG_DISTANCE || dominance >= GREEN_DOMINANCE_MARGIN) {
      // Definitely background (pure green core OR green-dominant). Key out.
      raw[i] = 0;
      raw[i + 1] = 0;
      raw[i + 2] = 0;
      raw[i + 3] = 0;
    } else if (dominance > GREEN_DOMINANCE_MARGIN - FEATHER_BAND) {
      // Transition band: dominance is near the margin → partial alpha for
      // anti-aliased edges between subject and background.
      const t = (GREEN_DOMINANCE_MARGIN - dominance) / FEATHER_BAND; // 0..1, 1=keep
      const alpha = Math.round(t * 255);
      if (alpha < RESIDUE_ALPHA_FLOOR) {
        raw[i] = 0;
        raw[i + 1] = 0;
        raw[i + 2] = 0;
        raw[i + 3] = 0;
      } else {
        raw[i + 3] = alpha;
      }
    }
    // else: subject (R-dominant or neutral) → keep original alpha (255).
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
): Promise<{ output: Buffer; keyedPixels: number; totalPixels: number }> {
  const { r: kr, g: kg, b: kb } = CHROMA_KEY_COLOR;
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const raw: Buffer = await sharp(input).ensureAlpha().raw().toBuffer();

  // Count background pixels using the same green-dominance classifier as
  // chromaKey (a pixel is background if near pure-green OR green-dominant).
  let keyed = 0;
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    const dr = r - kr;
    const dg = g - kg;
    const db = b - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    const dominance = Math.min(g - r, g - b);
    if (dist <= PURE_BG_DISTANCE || dominance >= GREEN_DOMINANCE_MARGIN)
      keyed += 1;
  }

  const output = await chromaKey(input);
  return {
    output,
    keyedPixels: keyed,
    totalPixels: width * height,
  };
}
