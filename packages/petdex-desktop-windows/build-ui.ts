// Build the self-contained index.html with all three features.
// Run: bun packages/petdex-desktop-windows/build-ui.ts

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const petsDir = join(homedir(), ".petdex", "pets");
const pets = readdirSync(petsDir).filter((d) => {
  try {
    readFileSync(join(petsDir, d, "pet.json"));
    return true;
  } catch {
    return false;
  }
});
const slug = pets[0] || "aurelion-sol";
const spritePath = join(petsDir, slug, "spritesheet.webp");
const sprite = readFileSync(spritePath);
const meta = JSON.parse(readFileSync(join(petsDir, slug, "pet.json")));
const name = meta.displayName || slug;
const compact = await sharp(sprite).webp({ quality: 80 }).toBuffer();
const b64 = compact.toString("base64");
const gridH = 1872;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Petdex</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#0a0a1a;width:192px;height:288px;overflow:hidden;user-select:none;-webkit-user-select:none;transition:width .3s,height .3s}
body.expanded{overflow:auto}
#root{position:fixed;top:0;left:0;width:192px;height:288px;cursor:grab}
#root:active{cursor:grabbing}
.pet-sprite{
  --sprite-row:0;--sprite-frames:6;--sprite-duration:1100ms;
  --sprite-y:calc(var(--sprite-row) * -208px);
  --sprite-end-x:calc(var(--sprite-frames) * -192px);
  position:absolute;bottom:0;left:0;width:192px;height:208px;
  background-image:url(data:image/webp;base64,${b64});
  background-repeat:no-repeat;background-size:1536px ${gridH}px;
  image-rendering:pixelated;
  animation:pet-state var(--sprite-duration) steps(var(--sprite-frames)) infinite;
  pointer-events:none;transition:transform .15s ease,filter .2s ease
}
#root:active .pet-sprite{transform:scale(1.1);filter:brightness(1.2)}
.pet-sprite.fast{transform:scale(1.15) rotate(-5deg);filter:brightness(1.3) drop-shadow(0 0 8px #ffd700)}
@keyframes pet-state{from{background-position:0 var(--sprite-y)}to{background-position:var(--sprite-end-x) var(--sprite-y)}}
#quit{position:absolute;top:4px;right:4px;width:24px;height:24px;background:#e74c3c;border-radius:5px;z-index:10;display:flex;align-items:center;justify-content:center;color:#fff;font:bold 14px sans-serif;cursor:pointer;border:2px solid #c0392b;pointer-events:auto}
#quit:hover{background:#ff5555;transform:scale(1.1)}
#gallery-btn{position:absolute;top:4px;right:34px;width:24px;height:24px;background:#2a4a8a;border-radius:5px;z-index:10;display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;pointer-events:auto;border:1px solid #3a5a9a}
#gallery-btn:hover{background:#3a6abb;transform:scale(1.1)}
#switch-btn{position:absolute;top:4px;right:64px;width:24px;height:24px;background:#2a8a4a;border-radius:5px;z-index:10;display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;pointer-events:auto;border:1px solid #3a9a5a}
#switch-btn:hover{background:#3abb6a;transform:scale(1.1)}
#bubble{position:absolute;bottom:218px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,.95);color:#111;font:11px/1.4 system-ui,sans-serif;padding:6px 10px;border-radius:8px;max-width:180px;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:0;transition:opacity .25s ease;pointer-events:none;white-space:pre-wrap;z-index:20}
#bubble.visible{opacity:1}
#label{position:absolute;top:5px;left:8px;font:10px monospace;color:rgba(255,215,0,.45);pointer-events:none;z-index:5}

/* Settings panel */
#settings{
  display:none;position:absolute;top:0;left:0;width:100%;height:100%;
  background:#12122a;z-index:30;overflow:auto;padding:12px;
  font:13px/1.5 system-ui,sans-serif;color:#ddd
}
#settings.visible{display:block}
#settings h3{font-size:14px;margin-bottom:8px;color:#6b8cff}
#settings input{width:100%;padding:6px;background:#1e1e3a;border:1px solid #444;border-radius:4px;color:#eee;font:12px monospace;margin-bottom:6px}
#settings button{padding:6px 14px;background:#6b8cff;border:none;border-radius:4px;color:#fff;cursor:pointer;margin-bottom:10px}
#settings .cost{font-size:11px;color:#888;margin-bottom:12px;padding-top:8px;border-top:1px solid #333}
#settings .close-btn{position:absolute;top:8px;right:8px;width:24px;height:24px;background:#444;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;font:14px sans-serif}

/* Gallery panel */
#gallery{
  display:none;position:absolute;top:0;left:0;width:100%;height:100%;
  background:#12122a;z-index:30;overflow:auto;padding:10px;
  font:12px/1.4 system-ui,sans-serif;color:#ddd
}
#gallery.visible{display:block}
#gallery h3{font-size:14px;margin-bottom:8px;color:#6b8cff}
#gallery .close-btn{position:fixed;top:8px;right:8px;width:32px;height:32px;background:#e74c3c;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;font:bold 18px sans-serif;z-index:50;border:2px solid #c0392b}
#gallery .close-btn:hover{background:#ff5555;transform:scale(1.1)}
#gallery .search{width:calc(100% - 45px);padding:8px;background:#1e1e3a;border:1px solid #444;border-radius:6px;color:#eee;font:13px sans-serif;margin-bottom:10px}
#gallery .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding-bottom:20px}
#gallery .pet-card{background:#1e1e3a;border-radius:8px;padding:8px;cursor:pointer;text-align:center;overflow:hidden;transition:background .2s;border:1px solid #2a2a4a}
#gallery .pet-card:hover{background:#2a4a6a;border-color:#4a7aaa}
#gallery .pet-card .pet-anim{width:96px;height:104px;margin:0 auto 6px;overflow:hidden;position:relative;border-radius:6px;background:#0a0a1a}
#gallery .pet-card .pet-anim-inner{
  width:96px;height:104px;
  background-repeat:no-repeat;background-size:768px 936px;
  image-rendering:pixelated;
  animation:gallery-idle 1100ms steps(6) infinite;
}
@keyframes gallery-idle{from{background-position:0 0}to{background-position:-576px 0}}
#gallery .pet-card .pname{font-size:11px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
#gallery .pet-card .pslug{font-size:9px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#gallery .loading{text-align:center;padding:30px;color:#666;font-size:13px}
#gallery .sentinel{height:60px;display:flex;align-items:center;justify-content:center;color:#555;font-size:11px}
#gallery .pet-btn{width:100%;padding:4px;margin-top:4px;border:none;border-radius:4px;color:#fff;font:11px sans-serif;cursor:pointer}
#gallery .pet-btn:hover{opacity:0.85}

/* Switcher panel (reuses gallery card styles) */
#switcher{display:none;position:absolute;top:0;left:0;width:100%;height:100%;background:#12122a;z-index:30;overflow:auto;padding:10px;font:12px/1.4 system-ui,sans-serif;color:#ddd}
#switcher.visible{display:block}
#switcher h3{font-size:14px;margin-bottom:8px;color:#6b8cff}
#switcher .close-btn{position:fixed;top:8px;right:8px;width:32px;height:32px;background:#e74c3c;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;font:bold 18px sans-serif;z-index:50;border:2px solid #c0392b}
#switcher .grid{display:grid;gap:10px;padding-bottom:20px}
#switcher .pet-card{background:#1e1e3a;border-radius:8px;padding:8px;cursor:pointer;text-align:center;overflow:hidden;transition:background .2s;border:1px solid #2a2a4a}
#switcher .pet-card:hover{background:#2a4a6a;border-color:#4a7aaa}
#switcher .pet-card .pet-anim{width:96px;height:104px;margin:0 auto 6px;overflow:hidden;position:relative;border-radius:6px;background:#0a0a1a}
#switcher .pet-card .pet-anim-inner{width:96px;height:104px;background-repeat:no-repeat;background-size:768px 936px;image-rendering:pixelated;animation:gallery-idle 1100ms steps(6) infinite}
#switcher .pet-card .pname{font-size:11px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
#switcher .pet-card .pslug{font-size:9px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#switcher .pet-btn{width:100%;padding:4px;margin-top:4px;border:none;border-radius:4px;color:#fff;font:11px sans-serif;cursor:pointer;background:#6b8cff}
#switcher .pet-btn:hover{opacity:0.85}
#switcher .loading{text-align:center;padding:30px;color:#666;font-size:13px}
</style>
</head>
<body>
<div id="root" data-tauri-drag-region>
  <div id="quit">X</div>
  <div id="switch-btn">&#128259;</div>
  <div id="gallery-btn">&#128064;</div>
  <div id="label">${name}</div>
  <div class="pet-sprite" id="sprite"></div>
  <div id="bubble"></div>
</div>

<div id="settings">
  <div class="close-btn" id="settings-close">X</div>
  <h3>Settings</h3>
  <label style="font-size:11px;color:#888;display:block;margin-bottom:4px">OpenRouter API key (local only)</label>
  <input type="password" id="or-key" placeholder="sk-or-..."/>
  <button id="save-key">Save key</button>
  <div id="key-status" style="font-size:11px;color:#888;margin-bottom:12px">Enter your key for AI pet generation.</div>
  <div class="cost">
    <b>Pet generation cost</b><br/>
    ~10 images via gpt-image-2 = <b>$0.40</b>. With retries up to $0.80.<br/>
    You confirm before each generation.
  </div>
</div>

<div id="gallery">
  <div class="close-btn" id="gallery-close">X</div>
  <h3>Pet Library</h3>
  <input type="text" class="search" id="pet-search" placeholder="Search 3700+ pets..."/>
  <div class="grid" id="pet-grid"><div class="loading">Loading...</div></div>
</div>

<div id="switcher">
  <div class="close-btn" id="switcher-close">X</div>
  <h3>Switch Pet</h3>
  <div class="grid" id="switcher-grid" style="grid-template-columns:repeat(2,1fr)"><div class="loading">Loading...</div></div>
</div>

<script>${readFileSync(join(here, "ui", "app.js"), "utf8")}</script>
</body>
</html>`;

const outPath = join(here, "ui", "index.html");
writeFileSync(outPath, html);
console.log("Built:", outPath, "(" + html.length + " bytes)");
