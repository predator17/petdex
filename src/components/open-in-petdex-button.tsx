"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { track } from "@vercel/analytics";
import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

type OpenInPetdexButtonProps = {
  slug: string;
};

/**
 * Hero CTA on /pets/<slug>. macOS-only for now since the desktop binary
 * is mac-first.
 *
 * Click behavior:
 * - Tries to launch `petdex://<slug>` via the registered URL scheme.
 *   If Petdex is installed (CFBundleURLSchemes in Info.plist), macOS
 *   routes the URL to the app via AppleEvent and the running pet
 *   swaps to <slug> (auto-installing if missing).
 * - If the app isn't installed, the scheme silently fails. We start
 *   a fallback timer that redirects to /download?next=install/<slug>
 *   after 1200ms — a delay long enough that an installed app will
 *   blur the page (cancelling the redirect) before it fires.
 *
 * Detection:
 * - Server-renders nothing. The client detects platform after hydration
 *   and unhides on macOS so Linux/Windows/iOS users don't see a CTA
 *   that would dead-end at a binary they can't install.
 */
export function OpenInPetdexButton({ slug }: OpenInPetdexButtonProps) {
  const [mounted, setMounted] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const t = useTranslations("openInPetdex");
  const locale = useLocale();

  useEffect(() => {
    setMounted(true);
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent ?? "";
    const platform =
      (navigator as Navigator & { platform?: string }).platform ?? "";
    // Desktop macOS only. The download flow only ships a macOS
    // desktop binary (no iOS app exists), so showing this CTA on
    // iPhone/iPad would dead-end at /download. iPadOS reports as
    // "MacIntel" on Safari so we also need to rule out touch +
    // small viewport heuristics used by iPadOS in desktop mode.
    const isIos =
      /iPhone|iPad|iPod/i.test(platform) || /iPhone|iPad|iPod/i.test(ua);
    const looksLikeIpadDesktopMode =
      platform === "MacIntel" &&
      typeof navigator.maxTouchPoints === "number" &&
      navigator.maxTouchPoints > 1;
    if (isIos || looksLikeIpadDesktopMode) {
      setIsMac(false);
      return;
    }
    setIsMac(/^Mac/i.test(platform) || /Mac OS X/i.test(ua));
  }, []);

  if (!mounted || !isMac) return null;

  const downloadHref = `/${locale}/download?next=${encodeURIComponent(`install/${slug}`)}`;
  const deepLink = `petdex://${slug}`;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Only intercept if the user isn't doing meta/ctrl/middle-click.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    // Track BEFORE preventDefault — the analytics call needs to fire
    // before the URL scheme attempt blurs the page (page-blur cancels
    // pending Vercel Analytics queue flushes on some browsers).
    track("open_in_petdex_click", { slug, source: "pet_page" });
    e.preventDefault();
    // Schedule the fallback redirect first so that even if the deep
    // link blocks the browser somehow, the user still ends up
    // somewhere useful.
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      window.location.href = downloadHref;
    }, 1200);
    // If the OS hands the URL off to Petdex, the page loses focus
    // briefly. We use that as a signal to cancel the fallback.
    const onBlur = () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onBlur);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onBlur);
    // Trigger the URL scheme. Setting location.href is the most
    // reliable way — it won't open a new tab and it survives popup
    // blockers because we're inside a synchronous click handler.
    window.location.href = deepLink;
  }

  return (
    <Link
      href={downloadHref}
      onClick={handleClick}
      aria-label={t("ariaLabel", { slug })}
      className="group relative isolate inline-flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/15 via-brand-light/10 to-brand-deep/15 p-3 text-left shadow-[0_8px_32px_-8px_oklch(from_var(--brand)_l_c_h/0.35)] transition-all hover:border-brand/50 hover:shadow-[0_12px_40px_-8px_oklch(from_var(--brand)_l_c_h/0.45)] active:scale-[0.99]"
    >
      <span
        aria-hidden="true"
        className="-translate-x-full pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 group-hover:translate-x-full dark:via-white/8"
      />

      <span className="relative grid size-12 shrink-0 place-items-center rounded-xl bg-surface shadow-md ring-1 ring-border-base/40">
        <Image
          src="/brand/petdex-desktop-icon.png"
          alt=""
          width={48}
          height={48}
          className="size-10 object-contain"
        />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-[0.2em] text-brand uppercase">
            {t("eyebrow")}
          </span>
          <span className="relative grid size-1.5 place-items-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-70" />
            <span className="relative inline-flex size-full rounded-full bg-brand" />
          </span>
        </span>
        <span className="font-semibold text-foreground text-sm leading-tight">
          {t("label")}
        </span>
        <span className="text-muted-2 text-xs leading-tight">
          {t("subtitle")}
        </span>
      </span>

      <ArrowRight className="relative size-4 shrink-0 text-brand transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
