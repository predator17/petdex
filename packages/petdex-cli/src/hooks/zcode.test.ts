import { describe, expect, test } from "bun:test";

import { AGENTS } from "./agents";
import { isPetdexEntry } from "./install";
import { stripPetdexHooks } from "./uninstall";

// Detection + uninstall tests for the ZCode process-form hook shape.
//
// The shell-form agents (claude-code, codex, gemini) embed the sidecar
// URL `127.0.0.1:7777/state` in their command string; isPetdexEntry and
// stripPetdexHooks key on that substring. The ZCode `type:"process"`
// hook carries NO such URL — it's an argv `[node, petdex.js, bubble, …]`
// — so without the extended detection (plan §3.4-D), re-install would
// duplicate entries and uninstall/doctor would silently miss them.
//
// These tests pin both the detection (isPetdexEntry) and the nested-
// events uninstall (stripPetdexHooks) for the ZCode shape.

describe("isPetdexEntry detects ZCode process-form hooks", () => {
  // Pull a real built entry from the registry so the test tracks the
  // actual emitted shape, not a hand-maintained copy.
  function sampleZcodeEntry(event: string): unknown {
    const agent = AGENTS.find((a) => a.id === "zcode");
    if (!agent) throw new Error("zcode agent missing");
    const cfg = agent.build() as {
      hooks: { events: Record<string, unknown[]> };
    };
    const entries = cfg.hooks.events[event];
    if (!entries || entries.length === 0)
      throw new Error(`no entry for event ${event}`);
    return entries[0];
  }

  test("recognizes a real built PreToolUse process-form entry", () => {
    expect(isPetdexEntry(sampleZcodeEntry("PreToolUse"))).toBe(true);
  });

  test("recognizes a real built Stop process-form entry", () => {
    expect(isPetdexEntry(sampleZcodeEntry("Stop"))).toBe(true);
  });

  test("recognizes a real built PostToolUseFailure process-form entry", () => {
    expect(isPetdexEntry(sampleZcodeEntry("PostToolUseFailure"))).toBe(true);
  });

  test("does not falsely match an unrelated user hook", () => {
    const userEntry = {
      hooks: [
        { type: "process", command: "echo", args: ["hello"], timeoutMs: 5000 },
      ],
    };
    expect(isPetdexEntry(userEntry)).toBe(false);
  });

  test("still recognizes the legacy shell-form sidecar-URL entry", () => {
    // Regression guard: the new detection branch must not break the
    // existing claude-code/codex/gemini detection path.
    const shellEntry = {
      hooks: [
        {
          type: "command",
          command:
            'curl -s -m 0.3 -X POST http://127.0.0.1:7777/state -d \'{"state":"running"}\'',
        },
      ],
    };
    expect(isPetdexEntry(shellEntry)).toBe(true);
  });
});

describe("stripPetdexHooks handles ZCode nested hooks.events", () => {
  test("strips petdex entries from hooks.events while keeping user events + enabled", () => {
    const agent = AGENTS.find((a) => a.id === "zcode");
    if (!agent) throw new Error("zcode agent missing");
    const built = agent.build() as {
      hooks: { events: Record<string, unknown[]> };
    };
    // Simulate a user config: their own enabled flag, a user event,
    // and our PreToolUse entry mixed in.
    const before = {
      hooks: {
        enabled: true,
        timeoutMs: 30000,
        maxOutputBytes: 500000,
        events: {
          // User's own hook — must survive the strip.
          SessionStart: [
            {
              hooks: [
                {
                  type: "process",
                  command: "echo",
                  args: ["user-start"],
                  timeoutMs: 5000,
                },
              ],
            },
          ],
          // Our petdex entry — must be removed.
          PreToolUse: built.hooks.events.PreToolUse,
        },
      },
    };
    const { value, changed } = stripPetdexHooks(before);
    expect(changed).toBe(true);
    const result = value as {
      hooks: {
        enabled: boolean;
        timeoutMs: number;
        maxOutputBytes: number;
        events: Record<string, unknown[]>;
      };
    };
    // User config keys preserved.
    expect(result.hooks.enabled).toBe(true);
    expect(result.hooks.timeoutMs).toBe(30000);
    expect(result.hooks.maxOutputBytes).toBe(500000);
    // User event preserved.
    expect(result.hooks.events.SessionStart).toBeDefined();
    expect(result.hooks.events.SessionStart.length).toBe(1);
    // Our event removed entirely.
    expect(result.hooks.events.PreToolUse).toBeUndefined();
  });

  test("removes the petdex-only events map, leaving the user's hooks keys", () => {
    const agent = AGENTS.find((a) => a.id === "zcode");
    if (!agent) throw new Error("zcode agent missing");
    const built = agent.build() as {
      hooks: { events: Record<string, unknown[]> };
    };
    const before = {
      hooks: {
        enabled: true,
        events: { Stop: built.hooks.events.Stop },
      },
    };
    const { value, changed } = stripPetdexHooks(before);
    expect(changed).toBe(true);
    const result = value as {
      hooks: { enabled: boolean; events?: Record<string, unknown[]> };
    };
    // The petdex event is gone; the events map is removed because it's
    // now empty. The user's `enabled: true` survives (it's not ours).
    expect(result.hooks.events).toBeUndefined();
    expect(result.hooks.enabled).toBe(true);
  });

  test("returns changed=false when the events map has no petdex entries", () => {
    const before = {
      hooks: {
        enabled: true,
        events: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "process",
                  command: "echo",
                  args: ["user"],
                  timeoutMs: 5000,
                },
              ],
            },
          ],
        },
      },
    };
    const { value, changed } = stripPetdexHooks(before);
    expect(changed).toBe(false);
    expect(value).toEqual(before);
  });
});
