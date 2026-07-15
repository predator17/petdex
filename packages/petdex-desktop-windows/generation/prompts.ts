/**
 * Per-state prompt templates for pet generation. These translate a
 * user-supplied pet description into the per-image prompts sent to
 * gpt-image-2.
 *
 * CRITICAL prompt discipline (plan §5.5): every prompt MUST instruct the
 * model to render on the flat chroma background (#00FF00) with no
 * gradients/shadows on the background, or the chroma key will leak fringe
 * pixels. This is part of the contract, not an optimization.
 *
 * Identity lock (plan §5.4): the canonical base image is passed as an
 * `input_references` entry on every row strip so the pet looks consistent
 * across all animation states.
 */
import { CHROMA_KEY_COLOR, ROWS, type RowSpec } from "./pet-contract.js";

/** The chroma background instruction appended to every prompt. */
const CHROMA_BG_INSTRUCTION = `Render on a flat solid pure green background (hex #00FF00, RGB 0,255,0). The background MUST be perfectly flat — no gradients, no shadows, no texture, no vignette. The subject's shadow must not touch the background. Leave generous margin around the subject so no part is clipped.`;

export interface PromptInput {
  /** The user's free-text pet description (sanitized + length-capped upstream). */
  description: string;
  /** Optional style/brand hints (e.g. "pixel art", "soft pastel"). */
  style?: string;
}

/**
 * The canonical base prompt: a single full-body portrait of the pet on the
 * chroma background. This image is the identity-lock reference for every
 * subsequent row strip.
 */
export function basePrompt(input: PromptInput): string {
  const style = input.style ? ` Art style: ${input.style}.` : "";
  return [
    `Full-body character reference sheet of: ${input.description}.`,
    "Centered, facing forward, full body visible from head to toe, neutral pose, clear silhouette.",
    style,
    CHROMA_BG_INSTRUCTION,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Per-state action description appended to the strip prompt. */
function stateAction(state: string): string {
  switch (state) {
    case "idle":
      return "a gentle idle breathing animation: subtle vertical bob and blink across frames";
    case "running-right":
      return "a run cycle moving rightward: legs and arms in motion, body leaning into the run";
    case "running-left":
      return "a run cycle moving leftward: mirror of the rightward run";
    case "waving":
      return "a friendly wave: arm raises and waves across frames";
    case "jumping":
      return "a vertical jump: crouch, launch, apex, land across frames";
    case "failed":
      return "a dejected reaction: slump or face-palm, conveying an error occurred";
    case "waiting":
      return "an idle waiting pose: looking around, slight shuffle, patient";
    case "running":
      return "active work animation: fast typing or thinking pose, energetic";
    case "review":
      return "a reviewing pose: reading/inspecting, thoughtful";
    default:
      return "a neutral animation";
  }
}

/**
 * A strip prompt for one animation row. The strip is a horizontal sequence
 * of frames for a single state, rendered left-to-right.
 */
export function stripPrompt(spec: RowSpec, input: PromptInput): string {
  const style = input.style ? ` Art style: ${input.style}.` : "";
  return [
    `Character: ${input.description}.`,
    `Horizontal animation strip of ${spec.columns} frames showing ${stateAction(spec.state)}.`,
    "Frames laid out left-to-right in a single row, evenly spaced, each frame a distinct key pose.",
    "The character must be visually identical to the provided reference image (same colors, proportions, features).",
    style,
    CHROMA_BG_INSTRUCTION,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Build the full ordered prompt list for a pet (base + one per row). */
export function allPrompts(input: PromptInput): {
  base: string;
  rows: { spec: RowSpec; prompt: string }[];
} {
  return {
    base: basePrompt(input),
    rows: ROWS.map((spec) => ({ spec, prompt: stripPrompt(spec, input) })),
  };
}

/** The chroma color as a CSS hex string for UI display. */
export const CHROMA_HEX = `#${CHROMA_KEY_COLOR.r.toString(16).padStart(2, "0")}${CHROMA_KEY_COLOR.g.toString(16).padStart(2, "0")}${CHROMA_KEY_COLOR.b.toString(16).padStart(2, "0")}`;
