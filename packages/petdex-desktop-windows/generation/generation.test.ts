import { describe, expect, test } from "bun:test";

import sharp from "sharp";

import { chromaKey, chromaKeyWithStats } from "./chroma-key";
import { composeAtlas } from "./compose-atlas";
import { extractStripFrames } from "./extract-strip-frames";
import { estimatePetCost, OPENROUTER_IMAGES_URL } from "./imagegen";
import {
  ATLAS_HEIGHT,
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  CHROMA_KEY_COLOR,
  ROWS,
  TOTAL_IMAGES_PER_PET,
} from "./pet-contract";
import { allPrompts, CHROMA_HEX } from "./prompts";
import { validateAtlas } from "./validate-atlas";

// Helpers: synthesize test images with sharp so the chroma-key/compose/
// validate pipeline can be exercised end-to-end WITHOUT hitting any API.

/** Build a strip buffer: `count` cells side-by-side, chroma-green bg with
 *  a colored square "sprite" in each cell so keying has real edges. */
async function makeStrip(
  count: number,
  spriteColor: { r: number; g: number; b: number },
): Promise<Buffer> {
  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < count; i++) {
    // A 40×40 square of `spriteColor` centered in each cell. Partial-alpha
    // fringe is simulated by placing it on the green bg; sharp's PNG encode
    // keeps it opaque, which is what the model returns.
    composites.push({
      input: {
        create: {
          width: 40,
          height: 40,
          channels: 4,
          background: { ...spriteColor, alpha: 1 },
        },
      },
      left: i * CELL_WIDTH + CELL_WIDTH / 2 - 20,
      top: CELL_HEIGHT / 2 - 20,
    });
  }
  return sharp({
    create: {
      width: count * CELL_WIDTH,
      height: CELL_HEIGHT,
      channels: 4,
      background: {
        r: CHROMA_KEY_COLOR.r,
        g: CHROMA_KEY_COLOR.g,
        b: CHROMA_KEY_COLOR.b,
        alpha: 1,
      },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

describe("pet-contract constants", () => {
  test("classic atlas is 1536x1872", () => {
    expect(ATLAS_WIDTH).toBe(1536);
    expect(ATLAS_HEIGHT).toBe(1872);
    expect(CELL_WIDTH).toBe(192);
    expect(CELL_HEIGHT).toBe(208);
  });

  test("has exactly 9 rows in the classic grid", () => {
    expect(ROWS.length).toBe(9);
    expect(ROWS.map((r) => r.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("row states match the STATE_MAP enum order", () => {
    // The CLI STATE_MAP maps session.end→waving (row 3), tool.before→
    // running (row 7). The row order here MUST match the sprite viewer.
    expect(ROWS[3].state).toBe("waving");
    expect(ROWS[7].state).toBe("running");
    expect(ROWS[8].state).toBe("review");
  });

  test("total images per pet is 1 base + 9 rows = 10", () => {
    expect(TOTAL_IMAGES_PER_PET).toBe(10);
  });

  test("chroma key color is pure green #00FF00", () => {
    expect(CHROMA_KEY_COLOR).toEqual({ r: 0, g: 255, b: 0 });
  });
});

describe("chromaKey", () => {
  test("keys pure-green background to fully transparent", async () => {
    // 100×100 solid green image.
    const green = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const keyed = await chromaKey(green);
    const raw = await sharp(keyed).ensureAlpha().raw().toBuffer();
    // Every pixel should be transparent with zeroed RGB.
    let allTransparent = true;
    for (let i = 0; i < raw.length; i += 4) {
      if (
        raw[i + 3] !== 0 ||
        raw[i] !== 0 ||
        raw[i + 1] !== 0 ||
        raw[i + 2] !== 0
      ) {
        allTransparent = false;
        break;
      }
    }
    expect(allTransparent).toBe(true);
  });

  test("leaves non-green pixels opaque", async () => {
    // 100×100 solid red image — nothing to key.
    const red = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const keyed = await chromaKey(red);
    const raw = await sharp(keyed).ensureAlpha().raw().toBuffer();
    // The center pixel should remain opaque red.
    const mid = 50 * 100 * 4 + 50 * 4;
    expect(raw[mid + 3]).toBe(255);
    expect(raw[mid]).toBe(255);
  });

  test("chromaKeyWithStats reports keyed pixel count", async () => {
    // Half green, half red split image.
    const split = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    })
      .composite([
        {
          input: {
            create: {
              width: 50,
              height: 100,
              channels: 4,
              background: { r: 255, g: 0, b: 0, alpha: 1 },
            },
          },
          left: 50,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const { keyedPixels, totalPixels } = await chromaKeyWithStats(split);
    expect(totalPixels).toBe(10000);
    // ~half the pixels (the green half) should be keyed.
    expect(keyedPixels).toBeGreaterThan(4500);
    expect(keyedPixels).toBeLessThan(5500);
  });
});

describe("extractStripFrames", () => {
  test("slices a strip into the expected frame count and chroma-keys", async () => {
    const strip = await makeStrip(6, { r: 100, g: 50, b: 200 });
    const frames = await extractStripFrames(strip, 6);
    expect(frames.length).toBe(6);
    expect(frames[0].index).toBe(0);
    expect(frames[5].index).toBe(5);
    // Each frame should decode to CELL_WIDTH × CELL_HEIGHT with alpha.
    for (const f of frames) {
      const meta = await sharp(f.buffer).metadata();
      expect(meta.width).toBe(CELL_WIDTH);
      expect(meta.height).toBe(CELL_HEIGHT);
      expect(meta.hasAlpha).toBe(true);
    }
  });

  test("throws when the strip is too narrow for the frame count", async () => {
    const narrow = await makeStrip(2, { r: 10, g: 20, b: 30 });
    await expect(extractStripFrames(narrow, 8)).rejects.toThrow(
      /too narrow|needs/,
    );
  });
});

describe("composeAtlas + validateAtlas", () => {
  test("composes a valid 8x9 atlas that passes validation", async () => {
    // Build one frame-set per row, each with the row's column count.
    const rowFrames = await Promise.all(
      ROWS.map(async (spec) => {
        const strip = await makeStrip(spec.columns, { r: 200, g: 100, b: 50 });
        const frames = await extractStripFrames(strip, spec.columns);
        return { row: spec.row, frames: frames.map((f) => f.buffer) };
      }),
    );
    const atlas = await composeAtlas(rowFrames);
    const meta = await sharp(atlas).metadata();
    expect(meta.width).toBe(ATLAS_WIDTH);
    expect(meta.height).toBe(ATLAS_HEIGHT);

    const result = await validateAtlas(atlas);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.width).toBe(ATLAS_WIDTH);
    expect(result.height).toBe(ATLAS_HEIGHT);
  });

  test("validateAtlas rejects a wrong-shaped image", async () => {
    const wrong = await sharp({
      create: {
        width: 500,
        height: 500,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const result = await validateAtlas(wrong);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("8x9"))).toBe(true);
  });

  test("validateAtlas cleans invisible RGB residue under low alpha (no fail)", async () => {
    // Low-alpha residue is visually invisible and causes no halos — the
    // validator now CLEANS it (zeroes RGB) rather than failing. Build a
    // 1536×1872 image where all pixels are low-alpha with non-zero RGB.
    const raw = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = 255; // R residue
      raw[i + 1] = 0;
      raw[i + 2] = 0;
      raw[i + 3] = 1; // alpha below threshold, but RGB != 0 → residue
    }
    const residued = await sharp(raw, {
      raw: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 4 },
    })
      .png()
      .toBuffer();
    const result = await validateAtlas(residued);
    // Residue was detected + cleaned → not a failure.
    expect(result.residuePixels).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
    // The cleaned atlas should have zero residue now.
    const recheckRaw = await sharp(result.cleanedAtlas)
      .ensureAlpha()
      .raw()
      .toBuffer();
    let residueAfter = 0;
    for (let i = 0; i < recheckRaw.length; i += 4) {
      if (
        recheckRaw[i + 3] < 16 &&
        (recheckRaw[i] !== 0 ||
          recheckRaw[i + 1] !== 0 ||
          recheckRaw[i + 2] !== 0)
      )
        residueAfter++;
    }
    expect(residueAfter).toBe(0);
  });

  test("validateAtlas fails on visible green-background bleed into subject", async () => {
    // Real defect: the green background bled into VISIBLE (high-alpha)
    // subject regions. Build a 1536×1872 image where most pixels are opaque
    // green-dominant (g >> r,b) — the key leaked into the subject.
    const raw = Buffer.alloc(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = 50; // R low
      raw[i + 1] = 200; // G dominant (green bleed)
      raw[i + 2] = 50; // B low
      raw[i + 3] = 255; // fully visible
    }
    const bad = await sharp(raw, {
      raw: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 4 },
    })
      .png()
      .toBuffer();
    const result = await validateAtlas(bad);
    expect(result.ok).toBe(false);
    expect(result.greenBleedPixels).toBeGreaterThan(0);
    expect(
      result.errors.some((e) => e.includes("green-background bleed")),
    ).toBe(true);
  });
});

describe("prompts", () => {
  test("every prompt enforces the flat chroma background", () => {
    const { base, rows } = allPrompts({ description: "a brave knight cat" });
    expect(base).toContain("#00FF00");
    expect(base.toLowerCase()).toContain("flat");
    for (const { prompt } of rows) {
      expect(prompt).toContain("#00FF00");
      expect(prompt.toLowerCase()).toContain("flat");
      // The prompt must PROHIBIT gradients/shadows (the discipline that
      // keeps the chroma key clean), not omit the word. "no gradients"
      // is the correct instruction — assert it's present.
      expect(prompt.toLowerCase()).toContain("no gradients");
      expect(prompt.toLowerCase()).toContain("no shadows");
    }
  });

  test("includes the user description and identity-lock instruction", () => {
    const { base, rows } = allPrompts({
      description: "a glowing crystal dragon",
      style: "pixel art",
    });
    expect(base).toContain("crystal dragon");
    expect(base).toContain("pixel art");
    // Strips must instruct visual consistency with the reference.
    expect(rows[0].prompt.toLowerCase()).toContain("identical");
  });

  test("CHROMA_HEX is #00ff00", () => {
    expect(CHROMA_HEX).toBe("#00ff00");
  });
});

describe("imagegen config + cost estimate", () => {
  test("targets the OpenRouter images endpoint, not OpenAI's path", () => {
    expect(OPENROUTER_IMAGES_URL).toBe("https://openrouter.ai/api/v1/images");
    expect(OPENROUTER_IMAGES_URL).not.toContain("/generations");
  });

  test("estimatePetCost scales with images and retries", () => {
    expect(estimatePetCost(10, 0)).toBeCloseTo(0.4, 2);
    expect(estimatePetCost(10, 1)).toBeCloseTo(0.8, 2);
    expect(estimatePetCost(20, 0)).toBeCloseTo(0.8, 2);
  });
});
