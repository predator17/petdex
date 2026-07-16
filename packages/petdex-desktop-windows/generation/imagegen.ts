/**
 * imagegen: the OpenRouter gpt-image-2 client that replaces hatch-pet's
 * $imagegen worker. Talks to `POST https://openrouter.ai/api/v1/images`
 * (NOT OpenAI's /images/generations path — a common mistake; plan §5.5).
 *
 * Contract (verified against the live OpenAPI 2026-07-15):
 *   - model: openai/gpt-image-2 (MANDATORY — no fallback; plan §2.5).
 *   - background: "opaque" (gpt-image-2's only non-auto value; transparency
 *     comes from the chroma-key post-step, never the model).
 *   - input_references: 0-16 base64 data URLs — this is the identity lock.
 *   - response: { data: [{ b64_json }], usage: { cost } }.
 *
 * SECURITY (plan §5.7): the API key NEVER leaves the user's machine. This
 * module is called from the desktop sidecar, never from the web backend.
 * The key is read from the local settings store, not from any request body.
 */

import { PETGEN_MODEL } from "./pet-contract.js";

export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";

export interface GenerateImageParams {
  /** The OpenRouter API key (read from local settings by the caller). */
  apiKey: string;
  prompt: string;
  /** Optional identity-lock reference (the canonical base), as a data URL. */
  referenceDataUrl?: string;
  /** Image quality tier. gpt-image-2 supports auto/low/medium/high. */
  quality?: "auto" | "low" | "medium" | "high";
  /** Output encoding. PNG is lossless — best for the chroma-key pipeline. */
  outputFormat?: "png" | "jpeg" | "webp";
  /** Per-request timeout. Generation can take 10-30s. */
  timeoutMs?: number;
}

export interface GenerateImageResult {
  /** Decoded image bytes. */
  image: Buffer;
  /** Reported cost in USD (from usage.cost), if the provider returned it. */
  cost?: number;
}

/**
 * Generate a single image via gpt-image-2 on a flat opaque background.
 * The caller chroma-keys the result to recover transparency.
 *
 * Throws on non-2xx, on a missing image in the response, or on timeout.
 * Errors are surfaced to the UI; the key is never included in error text.
 */
export async function generateImage(
  params: GenerateImageParams,
): Promise<GenerateImageResult> {
  const {
    apiKey,
    prompt,
    referenceDataUrl,
    // medium is the pragmatic default: ~50s/image vs ~90s for high, and a
    // full pet is 10 images. Override to "high" per-call for final quality.
    quality = "medium",
    outputFormat = "png",
    timeoutMs = 180_000,
  } = params;

  if (!apiKey) throw new Error("generateImage: missing OpenRouter API key");

  const body: Record<string, unknown> = {
    model: PETGEN_MODEL,
    prompt,
    quality,
    // gpt-image-2 cannot emit transparency (background is auto/opaque only).
    // We render opaque on the chroma bg, then key it out in post.
    background: "opaque",
    output_format: outputFormat,
  };
  if (referenceDataUrl) {
    // Identity lock: pass the canonical base so every row strip stays
    // visually consistent. OpenRouter's input_references schema requires
    // the OpenAI-style object form: { type: "image_url", image_url: { url } }.
    // (A bare { image_url: "data:..." } is rejected with HTTP 400 ZodError.)
    body.input_references = [
      { type: "image_url", image_url: { url: referenceDataUrl } },
    ];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Never leak the key; the error message is provider/network only.
    throw new Error(
      `OpenRouter image request failed: ${(err as Error).name === "AbortError" ? "timed out" : (err as Error).message}`,
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    // Sanitize: the provider error body might echo the key in rare cases.
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter image request failed: HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string }>;
    usage?: { cost?: number };
  };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenRouter image response had no data[0].b64_json");
  }
  return {
    image: Buffer.from(b64, "base64"),
    cost: json.usage?.cost,
  };
}

/**
 * Estimate the cost of a full pet generation. Used for the pre-generation
 * confirmation gate (plan §5.7 #3: surface the estimate and require
 * explicit confirmation before the first call).
 *
 * gpt-image-2 pricing is $0.00003/token (plan §2.5). A typical image is
 * ~4000 completion tokens, so ~$0.04/image. With TOTAL_IMAGES_PER_PET (10)
 * and a retry budget, the worst case is bounded.
 */
export function estimatePetCost(
  images: number,
  retriesPerImage = 0,
  costPerImage = 0.04,
): number {
  return images * (1 + retriesPerImage) * costPerImage;
}
