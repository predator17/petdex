/**
 * Extract individual frames from a horizontal animation strip.
 *
 * A generated strip is one row's worth of animation laid out
 * left-to-right: N frames of CELL_WIDTH each, on the chroma background.
 * This module slices the strip into N frame buffers of CELL_WIDTH×
 * CELL_HEIGHT and chroma-keys each one in the same pass.
 *
 * Ported from hatch-pet's extract_strip_frames.py (plan §5.2 phase 5).
 * The "stable-slots" QA method (plan §5.9) is handled by the caller: if a
 * frame is misaligned, the operator re-runs that single frame rather than
 * the whole strip.
 */
import sharp from "sharp";

import { chromaKey } from "./chroma-key.js";
import { CELL_HEIGHT, CELL_WIDTH } from "./pet-contract.js";

export interface ExtractedFrame {
  /** 0-based frame index within the strip. */
  index: number;
  /** Chroma-keyed PNG buffer at CELL_WIDTH×CELL_HEIGHT. */
  buffer: Buffer;
}

/**
 * Slice a strip buffer into `count` frames and chroma-key each.
 *
 * @param strip  The raw generated strip (opaque, on the chroma bg).
 * @param count  Number of frames in this strip (the row's `columns`).
 * @returns      One chroma-keyed frame buffer per slot, in order.
 */
export async function extractStripFrames(
  strip: Buffer,
  count: number,
): Promise<ExtractedFrame[]> {
  const meta = await sharp(strip).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error("extractStripFrames: strip has no dimensions");
  }
  // The strip's height should match CELL_HEIGHT; width should be at least
  // count*CELL_WIDTH. We don't hard-fail on exact dims (the model may
  // return a slightly different aspect) — we crop each frame to the cell
  // box from the left edge, which is the stable contract.
  const expectedWidth = count * CELL_WIDTH;
  if (width < expectedWidth) {
    throw new Error(
      `extractStripFrames: strip is ${width}px wide but needs ${expectedWidth}px for ${count} frames`,
    );
  }

  const frames: ExtractedFrame[] = [];
  for (let i = 0; i < count; i++) {
    const left = i * CELL_WIDTH;
    // Crop the cell, then resize to the exact cell dims if the model
    // returned a different strip height (keeps the atlas grid aligned).
    let cell = sharp(strip).extract({
      left,
      top: 0,
      width: CELL_WIDTH,
      height: Math.min(height, CELL_HEIGHT),
    });
    if (height !== CELL_HEIGHT) {
      cell = cell.resize(CELL_WIDTH, CELL_HEIGHT, { fit: "fill" });
    }
    const cellBuf = await cell.png().toBuffer();
    const keyed = await chromaKey(cellBuf);
    frames.push({ index: i, buffer: keyed });
  }
  return frames;
}
