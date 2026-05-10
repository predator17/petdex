/**
 * Setup-step list for the /download page.
 *
 * Now that Petdex.app ships as a signed + notarized .dmg and the CLI
 * resolves the binary from /Applications automatically, the install
 * flow collapses to a single command:
 *
 *   1. (already done) Drag Petdex.app to /Applications via the .dmg
 *   2. `npx petdex@latest init`   ← wires hooks + wakes the mascot
 *   *. `npx petdex@latest install <slug>` (optional, when /pets/<slug>
 *       sent the user here with ?next=install/<slug>)
 *   *. `npx petdex@latest update` (dimmed, runs anytime)
 *
 * `init` is the canonical first command. It runs `hooks install` (the
 * agent picker wizard) and then `up` (toggles the killswitch off and
 * launches the desktop), so there's no install-binary / wire-hooks /
 * launch-mascot ceremony anymore.
 */

export type SetupStep = {
  key: string;
  title: string;
  command: string;
  hint?: string;
  dimmed?: boolean;
};

type Translator = (key: string, values?: Record<string, string>) => string;

export function parsePendingPet(
  next: string | string[] | undefined,
): string | null {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("install/")) return null;
  const slug = value.slice("install/".length);
  // Mirror the server slug regex so a malformed ?next= can't render anything.
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null;
  return slug;
}

export function buildSetupSteps(
  t: Translator,
  pendingPet: string | null,
): SetupStep[] {
  const steps: SetupStep[] = [
    {
      key: "step1",
      title: t("setup.step1.title"),
      command: "npx petdex init",
      hint: t("setup.step1.hint"),
    },
  ];

  if (pendingPet) {
    steps.push({
      key: "installPet",
      title: t("setup.installPet.title", { slug: pendingPet }),
      command: `npx petdex install ${pendingPet}`,
      hint: t("setup.installPet.hint"),
    });
  }

  steps.push({
    key: "stayUpdated",
    title: t("setup.stayUpdated.title"),
    command: "npx petdex update",
    hint: t("setup.stayUpdated.hint"),
    dimmed: true,
  });

  return steps;
}
