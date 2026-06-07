// Migrate the remaining UploadThing (ufs.sh) pet assets to R2.
//
// 17 community pets still have spritesheet/petjson/zip URLs on the retired
// UploadThing host. This script downloads each asset, re-uploads it to R2 under
// the canonical `pets/{slug}-{hash}/{role}.{ext}` key, and rewrites the DB
// column to the assets.petdex.dev URL.
//
// Default is DRY: it downloads + validates every file and prints the target
// keys, but writes nothing to R2 or the DB. Pass --apply to perform the
// migration for real. Idempotent: columns already on assets.petdex.dev are
// skipped.
//
//   bun run --env-file=.env.local scripts/migrate-ufs-to-r2.ts          # dry
//   bun run --env-file=.env.local scripts/migrate-ufs-to-r2.ts --apply  # real
//   bun run --env-file=.env.local scripts/migrate-ufs-to-r2.ts --apply --slug mallow

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { neon } from "@neondatabase/serverless";
import { eq, like, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../src/lib/db/schema";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const slugFilter = (() => {
  const i = args.indexOf("--slug");
  return i >= 0 ? args[i + 1] : null;
})();

const DATABASE_URL = process.env.DATABASE_URL;
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET ?? "petdex-pets";
const PUBLIC_BASE = "https://assets.petdex.dev";

if (!DATABASE_URL) throw new Error("DATABASE_URL not set");
if (APPLY && (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY)) {
  throw new Error("R2 credentials required for --apply");
}

const db = drizzle(neon(DATABASE_URL), { schema });
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: ACCESS_KEY_ID ?? "",
    secretAccessKey: SECRET_ACCESS_KEY ?? "",
  },
});

const p = schema.submittedPets;

type Role = "sprite" | "petjson" | "zip";
const COLUMN: Record<Role, "spritesheetUrl" | "petJsonUrl" | "zipUrl"> = {
  sprite: "spritesheetUrl",
  petjson: "petJsonUrl",
  zip: "zipUrl",
};

function extFor(role: Role, url: string, contentType: string): string {
  if (role === "petjson") return "json";
  if (role === "zip") return "zip";
  // sprite: webp vs png from URL or content-type
  if (/\.png(\?|$)/i.test(url) || contentType.includes("png")) return "png";
  return "webp";
}

function contentTypeFor(role: Role, ext: string): string {
  if (role === "petjson") return "application/json";
  if (role === "zip") return "application/zip";
  return ext === "png" ? "image/png" : "image/webp";
}

function shortHash(input: string): string {
  // Stable 12-char hex from the source URL so re-runs produce the same key.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const a = (h >>> 0).toString(16).padStart(8, "0");
  let h2 = 0x9e3779b1 ^ h;
  for (let i = input.length - 1; i >= 0; i--) {
    h2 ^= input.charCodeAt(i);
    h2 = Math.imul(h2, 0x85ebca77);
  }
  const b = (h2 >>> 0).toString(16).padStart(8, "0");
  return (a + b).slice(0, 12);
}

async function main() {
  let rows = await db
    .select({
      id: p.id,
      slug: p.slug,
      status: p.status,
      spritesheetUrl: p.spritesheetUrl,
      petJsonUrl: p.petJsonUrl,
      zipUrl: p.zipUrl,
    })
    .from(p)
    .where(
      or(
        like(p.spritesheetUrl, "%ufs.sh%"),
        like(p.petJsonUrl, "%ufs.sh%"),
        like(p.zipUrl, "%ufs.sh%"),
      ),
    );

  if (slugFilter) rows = rows.filter((r) => r.slug === slugFilter);

  console.log(
    `${APPLY ? "[APPLY]" : "[DRY]"} migrating ${rows.length} pet(s) from ufs.sh to R2\n`,
  );

  const failures: string[] = [];
  let filesMigrated = 0;

  for (const row of rows) {
    // Per-pet hash so all three files share one folder.
    const hash = shortHash(`${row.id}:${row.slug}`);
    const updates: Partial<Record<(typeof COLUMN)[Role], string>> = {};
    console.log(`# ${row.slug} [${row.status}]`);

    for (const role of ["sprite", "petjson", "zip"] as Role[]) {
      const col = COLUMN[role];
      const sourceUrl = row[col];
      if (!sourceUrl) {
        console.log(`  ${role}: (empty) skip`);
        continue;
      }
      if (!sourceUrl.includes("ufs.sh")) {
        console.log(`  ${role}: already off ufs.sh, skip`);
        continue;
      }

      // 1. Download from UploadThing.
      let res: Response;
      try {
        res = await fetch(sourceUrl);
      } catch (err) {
        const msg = `  ${role}: DOWNLOAD FAILED (${(err as Error).message})`;
        console.log(msg);
        failures.push(`${row.slug}/${role}: download error`);
        continue;
      }
      if (!res.ok) {
        console.log(`  ${role}: DOWNLOAD ${res.status} ${res.statusText}`);
        failures.push(`${row.slug}/${role}: HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const srcCT = res.headers.get("content-type") ?? "";
      const ext = extFor(role, sourceUrl, srcCT);
      const ct = contentTypeFor(role, ext);
      const key = `pets/${row.slug}-${hash}/${role}.${ext}`;
      const publicUrl = `${PUBLIC_BASE}/${key}`;

      console.log(
        `  ${role}: ${buf.length} bytes -> ${key} (${ct})${APPLY ? "" : " [dry]"}`,
      );

      if (APPLY) {
        // 2. Upload to R2.
        try {
          await r2.send(
            new PutObjectCommand({
              Bucket: BUCKET,
              Key: key,
              Body: buf,
              ContentType: ct,
            }),
          );
        } catch (err) {
          console.log(
            `  ${role}: R2 UPLOAD FAILED (${(err as Error).message})`,
          );
          failures.push(`${row.slug}/${role}: upload error`);
          continue;
        }
        updates[col] = publicUrl;
      }
      filesMigrated++;
    }

    // 3. Rewrite DB columns for this pet (one statement, only if changed).
    if (APPLY && Object.keys(updates).length > 0) {
      await db.update(p).set(updates).where(eq(p.id, row.id));
      console.log(`  -> DB updated (${Object.keys(updates).length} cols)`);
    }
    console.log("");
  }

  console.log(
    `${APPLY ? "[APPLY]" : "[DRY]"} done. files ${APPLY ? "migrated" : "validated"}: ${filesMigrated}`,
  );
  if (failures.length > 0) {
    console.log(`\nFAILURES (${failures.length}):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
