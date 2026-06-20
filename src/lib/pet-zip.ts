import type JSZip from "jszip";

type ZipEntry = JSZip.JSZipObject;

type PetZipCandidate = {
  petJsonEntry: ZipEntry;
  petJsonPath: string;
  petDir: string;
  spriteEntry: ZipEntry | null;
  spritePath: string | null;
  spritesheetExt: "webp" | "png";
};

export type LocatedPetZip =
  | {
      kind: "pet";
      petJsonEntry: ZipEntry;
      petJsonPath: string;
      spriteEntry: ZipEntry;
      spritePath: string;
      spritesheetExt: "webp" | "png";
      petDirName: string | null;
      present: string[];
    }
  | {
      kind: "missingPetJson";
      present: string[];
    }
  | {
      kind: "missingSpritesheet";
      petJsonEntry: ZipEntry;
      petJsonPath: string;
      petDirName: string | null;
      present: string[];
    }
  | {
      kind: "allPetsBundle";
      petJsonPaths: string[];
      present: string[];
    };

export function locatePetZipEntries(zip: JSZip): LocatedPetZip {
  const files = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isSystemZipArtifact(entry.name),
  );
  const present = files.map((entry) => entry.name);
  const petJsonEntries = files.filter(
    (entry) => baseName(entry.name).toLowerCase() === "pet.json",
  );

  if (petJsonEntries.length === 0) {
    return { kind: "missingPetJson", present };
  }

  const candidates = petJsonEntries.map((petJsonEntry) =>
    candidateForPetJson(files, petJsonEntry),
  );
  const completeCandidates = candidates.filter(hasSpriteEntry);
  const rootCandidate = candidates.find((candidate) => candidate.petDir === "");

  if (rootCandidate && hasSpriteEntry(rootCandidate)) {
    return toLocatedPet(rootCandidate, present);
  }

  const completeNestedCandidates = completeCandidates.filter(
    (candidate) => candidate.petDir !== "",
  );

  if (completeNestedCandidates.length === 1) {
    return toLocatedPet(completeNestedCandidates[0], present);
  }

  if (completeNestedCandidates.length > 1) {
    return {
      kind: "allPetsBundle",
      petJsonPaths: completeNestedCandidates.map(
        (candidate) => candidate.petJsonPath,
      ),
      present,
    };
  }

  if (!rootCandidate && candidates.length > 1) {
    return {
      kind: "allPetsBundle",
      petJsonPaths: candidates.map((candidate) => candidate.petJsonPath),
      present,
    };
  }

  const candidate = rootCandidate ?? candidates[0];
  return {
    kind: "missingSpritesheet",
    petJsonEntry: candidate.petJsonEntry,
    petJsonPath: candidate.petJsonPath,
    petDirName: candidate.petDir ? baseName(candidate.petDir) : null,
    present,
  };
}

function hasSpriteEntry(
  candidate: PetZipCandidate,
): candidate is PetZipCandidate & { spriteEntry: ZipEntry } {
  return Boolean(candidate.spriteEntry);
}

function toLocatedPet(
  candidate: PetZipCandidate & { spriteEntry: ZipEntry },
  present: string[],
): LocatedPetZip {
  return {
    kind: "pet",
    petJsonEntry: candidate.petJsonEntry,
    petJsonPath: candidate.petJsonPath,
    spriteEntry: candidate.spriteEntry,
    spritePath: candidate.spritePath ?? "",
    spritesheetExt: candidate.spritesheetExt,
    petDirName: candidate.petDir ? baseName(candidate.petDir) : null,
    present,
  };
}

function candidateForPetJson(
  files: ZipEntry[],
  petJsonEntry: ZipEntry,
): PetZipCandidate {
  const petDir = dirName(petJsonEntry.name);
  const webpEntry = findSibling(files, petDir, "spritesheet.webp");
  const pngEntry = findSibling(files, petDir, "spritesheet.png");
  const spriteEntry = webpEntry ?? pngEntry;

  return {
    petJsonEntry,
    petJsonPath: petJsonEntry.name,
    petDir,
    spriteEntry,
    spritePath: spriteEntry?.name ?? null,
    spritesheetExt: webpEntry ? "webp" : "png",
  };
}

function findSibling(files: ZipEntry[], dir: string, fileName: string) {
  return (
    files.find(
      (entry) =>
        dirName(entry.name) === dir &&
        baseName(entry.name).toLowerCase() === fileName,
    ) ?? null
  );
}

function isSystemZipArtifact(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .some(
      (segment) =>
        segment === "__MACOSX" ||
        segment === ".DS_Store" ||
        segment.startsWith("._"),
    );
}

function dirName(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function baseName(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}
