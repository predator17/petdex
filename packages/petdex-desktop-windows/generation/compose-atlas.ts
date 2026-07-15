/**
 * compose-atlas: assemble per-row chroma-keyed frames into the final
 * 1536×1872 (8×9) atlas. Ported from hatch-pet's compose_atlas.py
 * (plan §5.2 phase 5).
 *
 * Each row contributes `columns` frames laid left-to-right starting at
 * column 0. Unused trailing cells in a row stay fully transparent. The
 * composite is built on a transparent canvas and emitted as WEBP (the
 * format the sprite viewer + Tauri loader expect).
 */
import sharp from "sharp";

import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  COLUMNS,
  ROWS,
} from "./pet-contract.js";

export interface RowFrames {
  /** The row index (0-based) these frames belong to. */
  row: number;
  /** Chroma-keyed frame buffers, left-to-right. */
  frames: Buffer[];
}

/**
 * Compose a full atlas from per-row frame sets. Rows without frames are
 * left fully transparent (the caller may skip optional rows like
 * running-left, which is derivable from running-right by mirroring).
 */
export async function composeAtlas(rowFrames: RowFrames[]): Promise<Buffer> {
  // Start from a fully-transparent 1536×1872 canvas. sharp's create() with
  // a 4-channel transparent background is the cleanest base.
  const canvas = sharp({
    create: {
      width: ATLAS_WIDTH,
      height: ATLAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  // Build the composite operations: one per frame, positioned at its cell.
  // sharp composites in array order; later ops draw on top, but since our
  // cells never overlap order doesn't matter for correctness.
  const composites: sharp.OverlayOptions[] = [];
  const byRow = new Map(rowFrames.map((rf) => [rf.row, rf.frames]));

  for (const spec of ROWS) {
    const frames = byRow.get(spec.row);
    if (!frames) continue; // optional row omitted
    const top = spec.row * CELL_HEIGHT;
    for (
      let col = 0;
      col < Math.min(frames.length, spec.columns, COLUMNS);
      col++
    ) {
      const left = col * CELL_WIDTH;
      composites.push({
        input: frames[col],
        left,
        top,
      });
    }
  }

  // WEBP is lossless-capable and keeps alpha; the viewer + Tauri loader
  // both accept it (lib.rs find_valid_sprite checks spritesheet.webp first).
  return canvas.composite(composites).webp({ lossless: true }).toBuffer();
}
