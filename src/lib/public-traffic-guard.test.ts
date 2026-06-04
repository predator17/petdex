import { describe, expect, it } from "bun:test";

import {
  publicTrafficGuardKey,
  publicTrafficGuardRule,
  shouldBlockKnownAbusiveClient,
  shouldBlockUntrustedAssetExport,
} from "@/lib/public-traffic-guard";

describe("public traffic guard", () => {
  it("targets public asset exports and catalog enumeration routes", () => {
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/api/pets/nukey/sticker",
      }),
    ).toBe("sticker");
    expect(
      publicTrafficGuardRule({
        method: "HEAD",
        pathname: "/api/pets/nukey/wastickers",
      }),
    ).toBe("pack");
    expect(
      publicTrafficGuardRule({ method: "GET", pathname: "/api/manifest" }),
    ).toBe("catalog");
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/api/collections/previews",
      }),
    ).toBe("catalog");
    expect(
      publicTrafficGuardRule({ method: "GET", pathname: "/api/pets/random" }),
    ).toBe("catalog");
    expect(
      publicTrafficGuardRule({ method: "GET", pathname: "/api/pets/search" }),
    ).toBe("catalog");
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/api/me/header-state",
      }),
    ).toBe("state");
    expect(publicTrafficGuardRule({ method: "GET", pathname: "/api/og" })).toBe(
      "metadata",
    );
    expect(
      publicTrafficGuardRule({ method: "GET", pathname: "/api/wechat-qr" }),
    ).toBe("metadata");
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/api/pets/nukey/codex-theme",
      }),
    ).toBe("catalog");
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/api/pets/nukey/metrics",
      }),
    ).toBe("catalog");
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/api/install-pet/nukey",
      }),
    ).toBe("catalog");
    expect(
      publicTrafficGuardRule({ method: "GET", pathname: "/install/nukey" }),
    ).toBe("catalog");
    expect(
      publicTrafficGuardRule({ method: "GET", pathname: "/zh/install/nukey" }),
    ).toBe("catalog");
    expect(
      publicTrafficGuardRule({ method: "GET", pathname: "/zh/pets/nukey" }),
    ).toBe("page");
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/kind/cat",
      }),
    ).toBe("page");
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/collections/cute-coders",
      }),
    ).toBe("page");
    expect(
      publicTrafficGuardRule({ method: "GET", pathname: "/zh/vibe/cozy" }),
    ).toBe("page");
    expect(
      publicTrafficGuardRule({ method: "GET", pathname: "/leaderboard" }),
    ).toBe("page");
  });

  it("does not target cheap reads or non-read methods", () => {
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/api/pets/nukey/thumb",
      }),
    ).toBeNull();
    expect(
      publicTrafficGuardRule({
        method: "POST",
        pathname: "/api/pets/nukey/sticker",
      }),
    ).toBeNull();
    expect(
      publicTrafficGuardRule({
        method: "GET",
        pathname: "/admin",
      }),
    ).toBeNull();
  });

  it("blocks untrusted asset exports but allows same-origin browser fetches", () => {
    expect(
      shouldBlockUntrustedAssetExport({
        method: "GET",
        pathname: "/api/pets/nukey/sticker",
        headers: { "user-agent": "python-requests/2.32" },
        origin: "https://petdex.crafter.run",
      }),
    ).toBe(true);
    expect(
      shouldBlockUntrustedAssetExport({
        method: "GET",
        pathname: "/api/pets/nukey/sticker",
        headers: { "user-agent": "curl/8.7.1" },
        origin: "https://petdex.crafter.run",
      }),
    ).toBe(true);
    expect(
      shouldBlockUntrustedAssetExport({
        method: "GET",
        pathname: "/api/pets/nukey/sticker",
        headers: {
          "sec-fetch-site": "none",
          "user-agent": "Mozilla/5.0",
        },
        origin: "https://petdex.crafter.run",
      }),
    ).toBe(true);
    expect(
      shouldBlockUntrustedAssetExport({
        method: "GET",
        pathname: "/api/pets/nukey/sticker",
        headers: {
          "sec-fetch-site": "same-origin",
          "user-agent": "Mozilla/5.0",
        },
        origin: "https://petdex.crafter.run",
      }),
    ).toBe(false);
    expect(
      shouldBlockUntrustedAssetExport({
        method: "GET",
        pathname: "/api/pets/nukey/sticker",
        headers: {
          referer: "https://petdex.crafter.run/pets/nukey",
          "sec-fetch-site": "same-origin",
          "user-agent": "Mozilla/5.0",
        },
        origin: "https://petdex.crafter.run",
      }),
    ).toBe(false);
    expect(
      shouldBlockUntrustedAssetExport({
        method: "GET",
        pathname: "/api/pets/nukey/sticker",
        headers: {
          referer: "https://example.com/embed",
          "sec-fetch-site": "cross-site",
          "user-agent": "Mozilla/5.0",
        },
        origin: "https://petdex.crafter.run",
      }),
    ).toBe(true);
  });

  it("keys limits by client IP headers", () => {
    expect(
      publicTrafficGuardKey({
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      }),
    ).toBe("203.0.113.9");
    expect(
      publicTrafficGuardKey({
        "x-real-ip": "198.51.100.4",
        "x-forwarded-for": "203.0.113.9",
      }),
    ).toBe("198.51.100.4");
  });

  it("blocks the known abusive client signature", () => {
    expect(
      shouldBlockKnownAbusiveClient({
        "x-forwarded-for": "133.106.50.116",
        "user-agent": "Mozilla/5.0",
      }),
    ).toBe(true);
    expect(
      shouldBlockKnownAbusiveClient({
        "x-forwarded-for": "203.0.113.1",
        "user-agent": "PetOverlayCompose-PixelArtClassifier",
      }),
    ).toBe(true);
    expect(
      shouldBlockKnownAbusiveClient({
        "x-forwarded-for": "203.0.113.1",
        "user-agent": "Mozilla/5.0",
      }),
    ).toBe(false);
  });
});
