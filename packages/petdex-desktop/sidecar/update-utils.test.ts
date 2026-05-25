import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DESKTOP_PREFERENCES,
  findDmgAsset,
  findEnclosingAppBundle,
  parseDesktopPreferences,
  parseHdiutilMount,
} from "./update-utils";

describe("desktop update utils", () => {
  test("parses desktop preferences with safe defaults", () => {
    expect(parseDesktopPreferences('{"autoInstallUpdates":false}')).toEqual({
      autoInstallUpdates: false,
    });
    expect(parseDesktopPreferences('{"autoInstallUpdates":"no"}')).toEqual(
      DEFAULT_DESKTOP_PREFERENCES,
    );
    expect(parseDesktopPreferences("not json")).toEqual(
      DEFAULT_DESKTOP_PREFERENCES,
    );
  });

  test("finds the enclosing macOS app bundle", () => {
    expect(
      findEnclosingAppBundle(
        "/Applications/Petdex.app/Contents/Resources/sidecar/server.js",
      ),
    ).toBe("/Applications/Petdex.app");
    expect(findEnclosingAppBundle("/tmp/petdex/sidecar/server.js")).toBeNull();
  });

  test("selects the DMG asset for the current architecture label", () => {
    const release = {
      tag_name: "desktop-v0.2.2",
      assets: [
        {
          name: "Petdex-x64.dmg",
          browser_download_url: "https://example.com/x64.dmg",
          size: 1,
        },
        {
          name: "Petdex-arm64.dmg",
          browser_download_url: "https://example.com/arm64.dmg",
          size: 1,
        },
      ],
    };
    expect(findDmgAsset(release, "arm64")?.name).toBe("Petdex-arm64.dmg");
    expect(findDmgAsset(release, "x64")?.name).toBe("Petdex-x64.dmg");
    expect(findDmgAsset(release, "riscv64")).toBeNull();
  });

  test("parses hdiutil mount output with volume names that contain spaces", () => {
    expect(
      parseHdiutilMount("/dev/disk4s1\tApple_HFS\t/Volumes/Petdex 0.2.2\n"),
    ).toBe("/Volumes/Petdex 0.2.2");
    expect(parseHdiutilMount("no mounted volume")).toBeNull();
  });
});
