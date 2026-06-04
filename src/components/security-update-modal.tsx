"use client";

import { useState } from "react";

import { ArrowRight, ExternalLink, ShieldCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { CommandLine } from "@/components/command-line";

type SecurityUpdateModalProps = {
  onClose: () => void;
};

const ORIGIN_REQUEST_URL = `https://github.com/crafter-station/petdex/issues/new?${new URLSearchParams(
  {
    title: "Origin access request for Petdex assets",
    body: [
      "Origin URL:",
      "",
      "Use case:",
      "",
      "Expected asset paths:",
      "",
      "Contact:",
    ].join("\n"),
  },
).toString()}`;

export function SecurityUpdateModal({ onClose }: SecurityUpdateModalProps) {
  const t = useTranslations("securityUpdate");
  const [closing, setClosing] = useState(false);

  function close(_reason: "dismiss" | "done" | "origin_request" = "dismiss") {
    setClosing(true);
    window.setTimeout(() => {
      onClose();
    }, 220);
  }

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-end justify-center px-4 pb-4 sm:items-center sm:p-6 ${
        closing ? "pointer-events-none" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={t("ariaLabel")}
    >
      <button
        type="button"
        aria-label={t("dismissAria")}
        onClick={() => close("dismiss")}
        className={`absolute inset-0 bg-slate-900/30 backdrop-blur-sm transition-opacity duration-200 ${
          closing ? "opacity-0" : "opacity-100"
        }`}
      />

      <div
        className={`relative w-full max-w-lg overflow-hidden rounded-3xl border border-border-base bg-surface text-foreground shadow-[0_30px_80px_-20px_rgba(34,92,180,0.4)] transition-all duration-200 ${
          closing ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <div className="relative border-b border-border-base bg-brand-tint p-5 dark:bg-brand-tint-dark sm:p-6">
          <div className="flex min-w-0 items-start gap-4 pr-10">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-sm">
              <ShieldCheck className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[10px] tracking-[0.22em] text-brand uppercase">
                {t("eyebrow")}
              </p>
              <h2 className="mt-2 text-2xl leading-tight font-semibold tracking-tight text-foreground">
                {t("title")}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => close("dismiss")}
            aria-label={t("closeAria")}
            className="absolute top-4 right-4 grid size-8 place-items-center rounded-full bg-surface/90 text-muted-2 shadow-sm transition hover:bg-surface hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div className="space-y-3 text-sm leading-6 text-muted-2">
            <p>{t("description")}</p>
            <p>{t("impact")}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              {t("commandLabel")}
            </p>
            <CommandLine
              command="npx petdex@latest update"
              source="security-update-modal"
              className="w-full"
              wrap
            />
            <p className="text-xs leading-5 text-muted-3">{t("commandHint")}</p>
          </div>

          <div className="rounded-2xl border border-border-base bg-background/60 p-4">
            <p className="text-sm font-medium text-foreground">
              {t("originTitle")}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-2">
              {t("originBody")}
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={() => close("done")}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-inverse px-5 text-sm font-medium text-on-inverse transition hover:bg-inverse-hover"
            >
              {t("doneCta")}
              <ArrowRight className="size-4" />
            </button>
            <a
              href={ORIGIN_REQUEST_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => close("origin_request")}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border-base bg-surface px-4 text-sm font-medium text-muted-2 transition hover:border-border-strong hover:text-foreground"
            >
              {t("originCta")}
              <ExternalLink className="size-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
