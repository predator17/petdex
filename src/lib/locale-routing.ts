import { defaultLocale, type Locale } from "@/i18n/config";

export const SITE_URL = "https://petdex.crafter.run";

const HREFLANG_BY_LOCALE: Record<Locale, string> = {
  en: "en",
  es: "es",
  zh: "zh-Hans",
};

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

export function withLocale(pathname: string, locale: Locale): string {
  const normalized = normalizePathname(pathname);
  if (locale === defaultLocale) return normalized;
  return normalized === "/" ? `/${locale}` : `/${locale}${normalized}`;
}

export function stripLocalePrefix(pathname: string): string {
  const normalized = normalizePathname(pathname);
  if (normalized === "/en" || normalized.startsWith("/en/")) {
    return normalized.slice(3) || "/";
  }
  if (normalized === "/es" || normalized.startsWith("/es/")) {
    return normalized.slice(3) || "/";
  }
  if (normalized === "/zh" || normalized.startsWith("/zh/")) {
    return normalized.slice(3) || "/";
  }
  return normalized;
}

export function buildLocaleAlternates(pathname: string, currentLocale?: Locale) {
  const canonical = withLocale(pathname, currentLocale ?? defaultLocale);

  return {
    canonical,
    languages: {
      [HREFLANG_BY_LOCALE.en]: withLocale(pathname, "en"),
      [HREFLANG_BY_LOCALE.es]: withLocale(pathname, "es"),
      [HREFLANG_BY_LOCALE.zh]: withLocale(pathname, "zh"),
      "x-default": canonical,
    },
  };
}

export function buildAbsoluteUrl(pathname: string, locale: Locale): string {
  return new URL(withLocale(pathname, locale), SITE_URL).toString();
}

export function buildAbsoluteLocaleAlternates(pathname: string) {
  return {
    languages: {
      [HREFLANG_BY_LOCALE.en]: buildAbsoluteUrl(pathname, "en"),
      [HREFLANG_BY_LOCALE.es]: buildAbsoluteUrl(pathname, "es"),
      [HREFLANG_BY_LOCALE.zh]: buildAbsoluteUrl(pathname, "zh"),
      "x-default": buildAbsoluteUrl(pathname, "en"),
    },
  };
}
