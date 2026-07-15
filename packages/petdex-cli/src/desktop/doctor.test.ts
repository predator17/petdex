import { describe, expect, test } from "bun:test";

import { homeDir } from "./doctor";

// Platform-branching tests for the doctor.ts Windows fixes (plan §4.6).
//
// The bugs: homeDir() used `HOME ?? homedir()` with no USERPROFILE
// fallback, so on Windows it resolved to the MSYS/Git-Bash pseudo home
// instead of the real %USERPROFILE% — doctor then looked for
// ~/.petdex in the wrong place. The fix mirrors install.ts homeDir():
// USERPROFILE-first on win32, HOME-first on posix.

describe("doctor homeDir resolution", () => {
  // Save and restore process state so tests are hermetic.
  const realPlatform = process.platform;
  const realEnv = { ...process.env };

  function withEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
    // @ts-expect-error — process.platform/env are read-only at the type
    // level but writable at runtime for tests.
    process.platform = platform;
    process.env = { ...env };
  }

  function restore() {
    // @ts-expect-error — see withEnv.
    process.platform = realPlatform;
    process.env = realEnv;
  }

  test("prefers USERPROFILE over HOME on win32", () => {
    try {
      withEnv(
        { USERPROFILE: "C:\\Users\\realhome", HOME: "C:\\msys64\\home\\fake" },
        "win32",
      );
      expect(homeDir()).toBe("C:\\Users\\realhome");
    } finally {
      restore();
    }
  });

  test("prefers HOME over USERPROFILE on posix", () => {
    try {
      withEnv(
        { HOME: "/home/real", USERPROFILE: "C:\\should-not-win" },
        "linux",
      );
      expect(homeDir()).toBe("/home/real");
    } finally {
      restore();
    }
  });

  test("falls back to HOME when USERPROFILE unset on win32", () => {
    try {
      withEnv({ HOME: "C:\\fallback" }, "win32");
      expect(homeDir()).toBe("C:\\fallback");
    } finally {
      restore();
    }
  });

  test("falls back to USERPROFILE when HOME unset on posix", () => {
    try {
      withEnv({ USERPROFILE: "/fallback" }, "linux");
      expect(homeDir()).toBe("/fallback");
    } finally {
      restore();
    }
  });
});

// Sanity guard so an accidental removal of the export is caught.
describe("doctor module sanity", () => {
  test("homeDir is a function", () => {
    expect(typeof homeDir).toBe("function");
  });
});
