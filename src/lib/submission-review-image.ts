import sharp from "sharp";

import { petStates } from "@/lib/pet-states";

const SPRITESHEET_COLUMNS = 8;
const SPRITESHEET_ROWS = 9;
const POLICY_CELL_W = 192;
const POLICY_CELL_H = 208;
const EXPECTED_SPRITESHEET_W = SPRITESHEET_COLUMNS * POLICY_CELL_W;
const EXPECTED_SPRITESHEET_H = SPRITESHEET_ROWS * POLICY_CELL_H;
const POLICY_BACKGROUND = { r: 120, g: 120, b: 120 };
const MAX_POLICY_SOURCE_DIMENSION = 4096;
const MAX_POLICY_SOURCE_PIXELS = 16_777_216;
const MAX_POLICY_OUTPUT_CHARS = 2 * 1024 * 1024;

export async function policyReviewImageDataUrl(
  spriteBuffer: Buffer,
): Promise<string | null> {
  try {
    const metadata = await sharp(spriteBuffer).metadata();
    if (!metadata.width || !metadata.height) return null;
    if (
      metadata.width > MAX_POLICY_SOURCE_DIMENSION ||
      metadata.height > MAX_POLICY_SOURCE_DIMENSION ||
      metadata.width * metadata.height > MAX_POLICY_SOURCE_PIXELS
    ) {
      return null;
    }

    if (
      metadata.width !== EXPECTED_SPRITESHEET_W ||
      metadata.height !== EXPECTED_SPRITESHEET_H
    ) {
      return null;
    }

    const source = await sharp(spriteBuffer).ensureAlpha().raw().toBuffer();
    const extracted: sharp.OverlayOptions[] = [];
    for (const state of petStates) {
      for (let column = 0; column < state.frames; column++) {
        const cell = await sharp(source, {
          raw: {
            width: EXPECTED_SPRITESHEET_W,
            height: EXPECTED_SPRITESHEET_H,
            channels: 4,
          },
        })
          .extract({
            left: column * POLICY_CELL_W,
            top: state.row * POLICY_CELL_H,
            width: POLICY_CELL_W,
            height: POLICY_CELL_H,
          })
          .resize({
            width: POLICY_CELL_W,
            height: POLICY_CELL_H,
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer();

        extracted.push({
          input: await sharp({
            create: {
              width: POLICY_CELL_W,
              height: POLICY_CELL_H,
              channels: 4,
              background: { ...POLICY_BACKGROUND, alpha: 1 },
            },
          })
            .composite([{ input: cell }])
            .png()
            .toBuffer(),
          left: column * POLICY_CELL_W,
          top: state.row * POLICY_CELL_H,
        });
      }
    }
    const sheet = await sharp({
      create: {
        width: EXPECTED_SPRITESHEET_W,
        height: EXPECTED_SPRITESHEET_H,
        channels: 4,
        background: { ...POLICY_BACKGROUND, alpha: 1 },
      },
    })
      .composite(extracted)
      .png()
      .toBuffer();
    const dataUrl = `data:image/png;base64,${sheet.toString("base64")}`;
    if (dataUrl.length > MAX_POLICY_OUTPUT_CHARS) return null;
    return dataUrl;
  } catch {
    return null;
  }
}
