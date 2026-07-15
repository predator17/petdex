/**
 * The immutable pet-contract: the exact atlas grid + per-state frame table
 * that every generated pet must satisfy. Ported from hatch-pet's
 * SKILL.md (plan §5.3) and kept in lockstep with the web validator
 * (`src/lib/submissions-validation.ts`) and the sprite viewer's cell math.
 *
 * A generated pet is a single spritesheet atlas + a pet.json manifest:
 *   ~/.petdex/pets/<id>/spritesheet.webp
 *   ~/.petdex/pets/<id>/pet.json
 *
 * The atlas is an 8-column grid of fixed-size cells. Each animation state
 * occupies one row and uses a fixed set of columns with per-frame
 * durations. The STATE_MAP in the CLI (agents.ts) maps agent lifecycle
 * events to these rows, so the row order here MUST match that enum.
 */

/** Classic atlas: 8 columns × 9 rows of 192×208 px cells. */
export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const COLUMNS = 8;
export const CLASSIC_ROWS = 9;
export const V2_EXTRA_ROWS = 2;

/** Full classic atlas pixel dimensions. */
export const ATLAS_WIDTH = COLUMNS * CELL_WIDTH; // 1536
export const ATLAS_HEIGHT = CLASSIC_ROWS * CELL_HEIGHT; // 1872

/** V2 (8×11) atlas height — adds 2 rows of look-direction frames. */
export const ATLAS_HEIGHT_V2 = (CLASSIC_ROWS + V2_EXTRA_ROWS) * CELL_HEIGHT; // 2288

/**
 * Per-state frame layout. `columns` is the count of frames used from the
 * left edge of the row (unused trailing cells stay fully transparent).
 * `durations` are the per-frame display times in milliseconds; the last
 * value repeats if an animation has more loops than entries.
 *
 * Row order is fixed and MUST match the sprite viewer's row indexing and
 * the CLI STATE_MAP (tool.before→running row 7, session.end→waving row 3).
 */
export interface RowSpec {
  row: number;
  state: string;
  columns: number;
  durations: number[]; // ms
}

export const ROWS: readonly RowSpec[] = [
  {
    row: 0,
    state: "idle",
    columns: 6,
    durations: [280, 110, 110, 140, 140, 320],
  },
  {
    row: 1,
    state: "running-right",
    columns: 8,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  {
    row: 2,
    state: "running-left",
    columns: 8,
    durations: [120, 120, 120, 120, 120, 120, 120, 220],
  },
  { row: 3, state: "waving", columns: 4, durations: [140, 140, 140, 280] },
  {
    row: 4,
    state: "jumping",
    columns: 5,
    durations: [140, 140, 140, 140, 280],
  },
  {
    row: 5,
    state: "failed",
    columns: 8,
    durations: [140, 140, 140, 140, 140, 140, 140, 240],
  },
  {
    row: 6,
    state: "waiting",
    columns: 6,
    durations: [150, 150, 150, 150, 150, 260],
  },
  {
    row: 7,
    state: "running",
    columns: 6,
    durations: [120, 120, 120, 120, 120, 220],
  },
  {
    row: 8,
    state: "review",
    columns: 6,
    durations: [150, 150, 150, 150, 150, 280],
  },
] as const;

/** The flat background color gpt-image-2 renders on, keyed out in post. */
export const CHROMA_KEY_COLOR = { r: 0, g: 255, b: 0 } as const; // #00FF00

/** pet.json manifest shape (4 required fields). */
export interface PetJson {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
}

/**
 * Total image count for a full pet: 1 canonical base + one strip per row.
 * Used for the pre-generation cost estimate (plan §5.7 #3).
 */
export const TOTAL_IMAGES_PER_PET = 1 + ROWS.length; // 10

/** The OpenRouter model mandated by the maintainer (plan §2.5, §5.4). */
export const PETGEN_MODEL = "openai/gpt-image-2";
