export const DEFAULT_R2_PUBLIC_BASE = "https://assets.petdex.dev";
export const WORKERS_DEV_R2_PUBLIC_BASE =
  "https://petdex-assets.raillyhugo.workers.dev";
export const LEGACY_R2_PUBLIC_BASE =
  "https://pub-94495283df974cfea5e98d6a9e3fa462.r2.dev";

function normalizeBase(raw: string | undefined): string {
  if (!raw) return DEFAULT_R2_PUBLIC_BASE;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return DEFAULT_R2_PUBLIC_BASE;
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    const normalized = parsed.toString().replace(/\/+$/, "");
    if (
      normalized === LEGACY_R2_PUBLIC_BASE ||
      normalized === WORKERS_DEV_R2_PUBLIC_BASE
    ) {
      return DEFAULT_R2_PUBLIC_BASE;
    }
    return normalized;
  } catch {
    return DEFAULT_R2_PUBLIC_BASE;
  }
}

export const R2_PUBLIC_BASE = normalizeBase(process.env.R2_PUBLIC_BASE);

export const R2_PUBLIC_HOSTS = new Set<string>([
  new URL(DEFAULT_R2_PUBLIC_BASE).host,
  new URL(LEGACY_R2_PUBLIC_BASE).host,
  new URL(WORKERS_DEV_R2_PUBLIC_BASE).host,
  new URL(R2_PUBLIC_BASE).host,
]);

export function toCurrentR2PublicUrl(raw: string): string;
export function toCurrentR2PublicUrl(raw: null): null;
export function toCurrentR2PublicUrl(raw: string | null): string | null;
export function toCurrentR2PublicUrl(raw: string | null): string | null {
  if (!raw) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || !R2_PUBLIC_HOSTS.has(parsed.host)) {
      return raw;
    }
    return `${R2_PUBLIC_BASE}${parsed.pathname}${parsed.search}`;
  } catch {
    return raw;
  }
}

export function keyFromR2PublicUrl(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || !R2_PUBLIC_HOSTS.has(parsed.host)) {
      return null;
    }
    const key = parsed.pathname.replace(/^\/+/, "");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}
