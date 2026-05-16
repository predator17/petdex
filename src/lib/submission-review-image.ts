import sharp from "sharp";

const SPRITESHEET_COLUMNS = 8;
const SPRITESHEET_ROWS = 9;
const POLICY_SAMPLE_COLUMNS = SPRITESHEET_COLUMNS;
const POLICY_SAMPLE_MAX_ROWS = 9;
const POLICY_CELL_W = 192;
const POLICY_CELL_H = 208;
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

    const sourceFrameW = Math.max(
      1,
      Math.floor(metadata.width / SPRITESHEET_COLUMNS),
    );
    const sourceFrameH = Math.max(
      1,
      Math.floor(metadata.height / SPRITESHEET_ROWS),
    );
    const rows = Math.max(
      1,
      Math.min(POLICY_SAMPLE_MAX_ROWS, SPRITESHEET_ROWS),
    );
    const columns = Math.max(1, SPRITESHEET_COLUMNS);
    const sampledColumns = sampleFrameColumns(columns, POLICY_SAMPLE_COLUMNS);
    const extracted: sharp.OverlayOptions[] = [];
    for (let row = 0; row < rows; row++) {
      for (const [columnIndex, column] of sampledColumns.entries()) {
        const cell = await sharp(spriteBuffer)
          .ensureAlpha()
          .extract({
            left: Math.min(column * sourceFrameW, metadata.width - 1),
            top: Math.min(row * sourceFrameH, metadata.height - 1),
            width: Math.min(
              sourceFrameW,
              metadata.width - column * sourceFrameW,
            ),
            height: Math.min(
              sourceFrameH,
              metadata.height - row * sourceFrameH,
            ),
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
          left: columnIndex * POLICY_CELL_W,
          top: row * POLICY_CELL_H,
        });
      }
    }
    const sheet = await sharp({
      create: {
        width: sampledColumns.length * POLICY_CELL_W,
        height: rows * POLICY_CELL_H,
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

function sampleFrameColumns(columns: number, count: number): number[] {
  if (columns <= count) {
    return Array.from({ length: columns }, (_, index) => index);
  }
  return [...new Set([0, Math.floor((columns - 1) / 2), columns - 1])].slice(
    0,
    count,
  );
}
