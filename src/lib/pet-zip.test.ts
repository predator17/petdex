import { describe, expect, it } from "bun:test";

import JSZip from "jszip";

import { locatePetZipEntries } from "@/lib/pet-zip";

describe("locatePetZipEntries", () => {
  it("accepts a pet zip with files at the root", () => {
    const zip = new JSZip();
    zip.file("pet.json", "{}");
    zip.file("spritesheet.webp", "sprite");

    const result = locatePetZipEntries(zip);

    expect(result.kind).toBe("pet");
    if (result.kind !== "pet") return;
    expect(result.petJsonPath).toBe("pet.json");
    expect(result.spritePath).toBe("spritesheet.webp");
    expect(result.petDirName).toBeNull();
    expect(result.spritesheetExt).toBe("webp");
  });

  it("accepts a zip made from one pet folder", () => {
    const zip = new JSZip();
    zip.file("boba/pet.json", "{}");
    zip.file("boba/spritesheet.png", "sprite");

    const result = locatePetZipEntries(zip);

    expect(result.kind).toBe("pet");
    if (result.kind !== "pet") return;
    expect(result.petJsonPath).toBe("boba/pet.json");
    expect(result.spritePath).toBe("boba/spritesheet.png");
    expect(result.petDirName).toBe("boba");
    expect(result.spritesheetExt).toBe("png");
  });

  it("keeps a single pet folder valid when the zip has hidden macOS files", () => {
    const zip = new JSZip();
    zip.file("boba/pet.json", "{}");
    zip.file("boba/spritesheet.webp", "sprite");
    zip.file("boba/.DS_Store", "noise");
    zip.file("__MACOSX/boba/._pet.json", "noise");
    zip.file("__MACOSX/boba/._spritesheet.webp", "noise");

    const result = locatePetZipEntries(zip);

    expect(result.kind).toBe("pet");
    if (result.kind !== "pet") return;
    expect(result.petDirName).toBe("boba");
    expect(result.present).not.toContain("__MACOSX/boba/._pet.json");
  });

  it("rejects a bundle with multiple complete pet folders", () => {
    const zip = new JSZip();
    zip.file("boba/pet.json", "{}");
    zip.file("boba/spritesheet.webp", "sprite");
    zip.file("kebo/pet.json", "{}");
    zip.file("kebo/spritesheet.webp", "sprite");

    const result = locatePetZipEntries(zip);

    expect(result.kind).toBe("allPetsBundle");
    if (result.kind !== "allPetsBundle") return;
    expect(result.petJsonPaths).toEqual(["boba/pet.json", "kebo/pet.json"]);
  });

  it("prefers root pet files when a nested pet folder is also present", () => {
    const zip = new JSZip();
    zip.file("pet.json", "{}");
    zip.file("spritesheet.webp", "root sprite");
    zip.file("boba/pet.json", "{}");
    zip.file("boba/spritesheet.webp", "nested sprite");

    const result = locatePetZipEntries(zip);

    expect(result.kind).toBe("pet");
    if (result.kind !== "pet") return;
    expect(result.petJsonPath).toBe("pet.json");
    expect(result.spritePath).toBe("spritesheet.webp");
    expect(result.petDirName).toBeNull();
  });

  it("uses a complete nested pet when root pet.json has no root spritesheet", () => {
    const zip = new JSZip();
    zip.file("pet.json", "{}");
    zip.file("boba/pet.json", "{}");
    zip.file("boba/spritesheet.webp", "nested sprite");

    const result = locatePetZipEntries(zip);

    expect(result.kind).toBe("pet");
    if (result.kind !== "pet") return;
    expect(result.petJsonPath).toBe("boba/pet.json");
    expect(result.spritePath).toBe("boba/spritesheet.webp");
    expect(result.petDirName).toBe("boba");
  });

  it("keeps root pet files valid when macOS metadata includes pet-like names", () => {
    const zip = new JSZip();
    zip.file("pet.json", "{}");
    zip.file("spritesheet.webp", "root sprite");
    zip.file("__MACOSX/._pet.json", "noise");
    zip.file("__MACOSX/._spritesheet.webp", "noise");

    const result = locatePetZipEntries(zip);

    expect(result.kind).toBe("pet");
    if (result.kind !== "pet") return;
    expect(result.petJsonPath).toBe("pet.json");
    expect(result.present).toEqual(["pet.json", "spritesheet.webp"]);
  });

  it("ignores system pet-like files when deciding whether pet.json exists", () => {
    const zip = new JSZip();
    zip.file("__MACOSX/._pet.json", "noise");
    zip.file("__MACOSX/._spritesheet.webp", "noise");

    const result = locatePetZipEntries(zip);

    expect(result).toEqual({ kind: "missingPetJson", present: [] });
  });
});
