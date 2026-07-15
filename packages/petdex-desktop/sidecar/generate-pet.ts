/**
 * Sidecar-local shim that re-exports the pet-generation orchestrator from
 * the sibling Windows desktop generation package. The sidecar bundles to a
 * single CJS file (`bun build --target=node --format=cjs`), and bun follows
 * this relative import at build time, pulling the generation pipeline +
 * sharp into the bundle.
 *
 * server.ts imports `generatePet` statically (a dynamic import() would be
 * left as a runtime require against a file that doesn't ship alongside
 * server.js). The pipeline only does work when POST /generate is hit, so
 * the static import has no boot cost beyond the module graph being in the
 * bundle.
 */
export {
  type GeneratePetParams,
  type GeneratePetResult,
  generatePet,
} from "../../petdex-desktop-windows/generation/generate-pet.ts";
