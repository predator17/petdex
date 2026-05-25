import { basename, dirname, resolve } from "node:path";

export type DesktopPreferences = {
  autoInstallUpdates: boolean;
};

export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string;
};

export type DesktopRelease = {
  tag_name: string;
  assets: ReleaseAsset[];
};

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  autoInstallUpdates: true,
};

export function parseDesktopPreferences(text: string): DesktopPreferences {
  try {
    const parsed = JSON.parse(text) as { autoInstallUpdates?: unknown };
    return {
      autoInstallUpdates:
        typeof parsed.autoInstallUpdates === "boolean"
          ? parsed.autoInstallUpdates
          : DEFAULT_DESKTOP_PREFERENCES.autoInstallUpdates,
    };
  } catch {
    return DEFAULT_DESKTOP_PREFERENCES;
  }
}

export function findEnclosingAppBundle(startPath: string): string | null {
  let current = resolve(startPath);
  while (true) {
    if (basename(current).endsWith(".app")) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function findDmgAsset(
  release: DesktopRelease,
  arch: string,
): ReleaseAsset | null {
  const archLabel = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : arch;
  const wanted = `Petdex-${archLabel}.dmg`;
  return release.assets.find((asset) => asset.name === wanted) ?? null;
}

export function parseHdiutilMount(stdout: string): string | null {
  let best: string | null = null;
  for (const line of stdout.split("\n")) {
    const idx = line.indexOf("/Volumes/");
    if (idx === -1) continue;
    const candidate = line.slice(idx).trim();
    if (!best || candidate.length > best.length) best = candidate;
  }
  return best;
}
