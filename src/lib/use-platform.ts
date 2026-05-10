"use client";

import { useEffect, useState } from "react";

/**
 * Coarse platform detection for client-side rendering decisions.
 * Used by the /download CTA and the per-pet "Open in Petdex"
 * button so we don't show a macOS-binary download to a Linux user.
 *
 * Returns "unknown" during SSR / first paint so the calling
 * component can render a neutral placeholder. After hydration the
 * component re-renders with the resolved value.
 *
 * iPadOS deserves a separate bucket because Safari reports it as
 * "MacIntel" with multi-touch; calling that "macos" would surface
 * a binary the iPad can't run.
 */
export type Platform =
  | "unknown"
  | "macos"
  | "linux"
  | "windows"
  | "ios"
  | "ipados"
  | "android"
  | "other";

export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>("unknown");

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setPlatform(detectPlatform());
  }, []);

  return platform;
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent ?? "";
  // navigator.platform is technically deprecated but still
  // populated on every browser we care about. The replacement
  // (userAgentData) isn't supported on Safari yet, so we keep
  // this and let it gracefully report "other" when both miss.
  const navPlatform =
    (navigator as Navigator & { platform?: string }).platform ?? "";

  if (/iPhone|iPod/i.test(navPlatform) || /iPhone|iPod/i.test(ua)) return "ios";
  // iPadOS in desktop-mode Safari spoofs MacIntel. Multi-touch
  // is the only signal that survives the spoof.
  if (/iPad/i.test(navPlatform) || /iPad/i.test(ua)) return "ipados";
  if (
    navPlatform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  ) {
    return "ipados";
  }
  if (/Android/i.test(ua)) return "android";
  if (/^Mac/i.test(navPlatform) || /Mac OS X/i.test(ua)) return "macos";
  if (/Win/i.test(navPlatform) || /Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(navPlatform) || /Linux/i.test(ua)) return "linux";
  return "other";
}
