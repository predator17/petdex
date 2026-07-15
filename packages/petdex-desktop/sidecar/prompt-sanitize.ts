/**
 * Sanitize a user-supplied string that will flow into an image-generation
 * prompt (plan §5.7 #4). Extracted into its own module so it can be unit-
 * tested WITHOUT importing server.ts (which binds port 7777 at load).
 *
 * Strips control characters (including the BOM and bidirectional-override
 * marks that could hide injection), collapses runs of whitespace, and caps
 * the length. The result is appended to a prompt TEMPLATE (never a
 * system/tool-instruction position) by the orchestrator, so even
 * adversarial text can only become part of the image description.
 */
export function sanitizePromptText(text: string, maxLen: number): string {
  // Drop C0/C1 control chars except tab/newline/carriage-return, plus the
  // Unicode BOM and bidirectional override marks (U+202A–U+202E, U+2066–
  // U+2069) used to hide prompt injection from visual review. We build the
  // set with code points rather than literal control escapes so the source
  // stays lint-clean (biome flags literal control chars).
  const controlCodes: number[] = [];
  for (let c = 0; c <= 0x1f; c++) {
    if (c !== 0x09 && c !== 0x0a && c !== 0x0d) controlCodes.push(c); // keep \t \n \r
  }
  for (let c = 0x7f; c <= 0x9f; c++) controlCodes.push(c);
  const bidiMarks = [
    0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067,
    0x2068, 0x2069, 0xfeff,
  ];
  const strip = new Set([...controlCodes, ...bidiMarks]);
  const stripped = [...text]
    .filter((ch) => !strip.has(ch.codePointAt(0) ?? -1))
    .join("");
  return stripped.replace(/\s+/g, " ").trim().slice(0, maxLen);
}
