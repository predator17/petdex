"use client";

import { ArrowRight, Clock } from "lucide-react";

import { type Platform, usePlatform } from "@/lib/use-platform";

import { CommandLine } from "@/components/command-line";

const MACOS_DOWNLOAD_URL = "/api/desktop/latest-release?asset=darwin-arm64";

/**
 * The hero-row "Download for macOS" + CLI install CTA, rendered
 * differently per detected platform so we never offer a click that
 * dead-ends in a binary the user can't run.
 *
 *   macOS         → primary download button (direct binary)
 *   linux/win     → disabled "Coming soon" pill + still-works CLI
 *                   note (CLI itself runs on those platforms too,
 *                   even if the GUI binary doesn't)
 *   ios/ipados    → "macOS-only desktop" coming-soon, no CTA at all
 *   android       → same as iOS
 *   unknown/other → neutral placeholder (SSR + first paint, or a
 *                   browser we couldn't classify)
 *
 * The CLI command line stays visible across every platform — the
 * `petdex install desktop` command just won't find a binary on
 * non-macOS today, but it returns a clear error rather than
 * pretending to install. That's still better DX than hiding the
 * mention entirely.
 */
export function DownloadCTA({
  primaryLabel,
  cliCommand,
  cliSubtext,
  comingSoonLabel,
  desktopOnlyLabel,
}: {
  primaryLabel: string;
  cliCommand: string;
  cliSubtext: string;
  comingSoonLabel: string;
  desktopOnlyLabel: string;
}) {
  const platform = usePlatform();

  return (
    <div className="mt-10 flex w-full flex-col items-center gap-3">
      <div className="flex w-full flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <PrimaryButton
          platform={platform}
          primaryLabel={primaryLabel}
          comingSoonLabel={comingSoonLabel}
          desktopOnlyLabel={desktopOnlyLabel}
        />
        <CommandLine
          command={cliCommand}
          source="download-hero"
          className="!h-12 w-full !rounded-full !px-5 !text-[13px] sm:w-auto sm:min-w-[280px]"
        />
      </div>
      <p className="text-xs text-muted-3">{cliSubtext}</p>
    </div>
  );
}

function PrimaryButton({
  platform,
  primaryLabel,
  comingSoonLabel,
  desktopOnlyLabel,
}: {
  platform: Platform;
  primaryLabel: string;
  comingSoonLabel: string;
  desktopOnlyLabel: string;
}) {
  // SSR / first paint / browser we couldn't classify: render a
  // skeleton-ish neutral pill instead of flashing a wrong CTA.
  // Same height/width as the macOS button to avoid layout shift.
  if (platform === "unknown" || platform === "other") {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-12 w-[180px] animate-pulse items-center justify-center rounded-full bg-surface-muted text-sm text-muted-3"
      />
    );
  }

  if (platform === "macos") {
    return (
      <a
        href={MACOS_DOWNLOAD_URL}
        rel="noreferrer"
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-inverse px-6 text-sm font-medium text-on-inverse transition hover:bg-inverse-hover"
      >
        {primaryLabel}
        <ArrowRight className="size-4" />
      </a>
    );
  }

  // Desktop platforms we don't have a binary for yet. The button
  // is non-clickable but mirrors the layout so we don't reflow.
  if (platform === "linux" || platform === "windows") {
    return (
      <span
        aria-disabled="true"
        className="inline-flex h-12 cursor-not-allowed items-center justify-center gap-2 rounded-full border border-border-base bg-surface-muted px-6 text-sm font-medium text-muted-2"
      >
        <Clock className="size-4" />
        {comingSoonLabel.replace(
          "{os}",
          platform === "linux" ? "Linux" : "Windows",
        )}
      </span>
    );
  }

  // Mobile + iPad — desktop app fundamentally won't run here.
  return (
    <span
      aria-disabled="true"
      className="inline-flex h-12 cursor-not-allowed items-center justify-center gap-2 rounded-full border border-border-base bg-surface-muted px-6 text-sm font-medium text-muted-2"
    >
      <Clock className="size-4" />
      {desktopOnlyLabel}
    </span>
  );
}

