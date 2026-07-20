// === DRAG: manual startDragging on mousedown (no data-tauri-drag-region) ===
// data-tauri-drag-region on #root captures ALL clicks, preventing buttons
// from working. Instead, we listen for mousedown on the background areas
// (not on buttons) and call Tauri's startDragging() manually. This is
// exactly how the macOS main.zig does it.
function setupManualDrag() {
  if (!window.__TAURI__ || !window.__TAURI__.window) {
    setTimeout(setupManualDrag, 200);
    return;
  }
  var win = window.__TAURI__.window.getCurrentWindow();
  var root = document.getElementById("root");
  root.addEventListener("mousedown", function (e) {
    // Only start drag for left-click on background (not buttons/sprite)
    if (e.button !== 0) return;
    var target = e.target;
    // Don't drag if clicking on interactive elements
    if (
      target.id === "quit" ||
      target.id === "switch-btn" ||
      target.id === "gallery-btn" ||
      target.closest(".pet-btn") ||
      target.closest(".close-btn") ||
      target.closest(".cat-tab") ||
      target.tagName === "INPUT" ||
      target.tagName === "BUTTON"
    ) {
      return;
    }
    win.startDragging().catch(function () {});
  });
}
setupManualDrag();

// === DRAG REACTION (Rust-side tracker, survives JS freeze) ===
// Rust records window Moved events during drag (even when JS is frozen).
// JS polls get_drag_result() every 100ms. When 'moved' is true and we
// haven't processed it yet, we read the direction/speed and react.
var lastProcessedDragId = 0;
function setupDragPoll() {
  if (!window.__TAURI__ || !window.__TAURI__.core) {
    setTimeout(setupDragPoll, 200);
    return;
  }
  var invoke = window.__TAURI__.core.invoke;
  setInterval(() => {
    invoke("get_drag_result")
      .then((r) => {
        if (!r || !r.moved) return;
        // New drag detected. Process it.
        var s = document.getElementById("sprite");
        if (!s) return;
        if (r.dist < 5) return; // too small, ignore

        // React based on direction + speed
        if (r.speed > 1.5) {
          // Fast drag → glow + whoosh + direction-aware running
          s.classList.add("fast");
          showBubble("whoosh!");
        } else {
          s.classList.remove("fast");
        }

        // Direction
        if (r.direction === "right") {
          setState("running-right");
        } else if (r.direction === "left") {
          setState("running-left");
        } else {
          setState("running");
        }

        // Reset tracker for next drag, then return to idle
        invoke("reset_drag").catch(() => {});
        setTimeout(() => {
          s.classList.remove("fast");
          setState("waving");
          showBubble("Done.");
          setTimeout(() => {
            setState("idle");
            hideBubble();
          }, 1200);
        }, 800);
      })
      .catch(() => {});
  }, 100);
}
setupDragPoll();

// === LOAD ACTIVE PET SPRITE DYNAMICALLY (not baked in CSS) ===
// The sprite is loaded at runtime via Tauri invoke, so switching pets
// actually changes the visible image without rebuilding HTML.
function loadActivePet() {
  if (!window.__TAURI__ || !window.__TAURI__.core) {
    setTimeout(loadActivePet, 200);
    return;
  }
  var invoke = window.__TAURI__.core.invoke;
  invoke("get_active_pet").then(function (pet) {
    if (!pet) {
      document.getElementById("label").textContent = "no pet";
      return;
    }
    document.getElementById("label").textContent = pet.name || pet.slug;
    invoke("read_file_as_base64", { path: pet.sprite_path }).then(function (b64) {
      var sprite = document.getElementById("sprite");
      if (sprite) {
        sprite.style.backgroundImage =
          "url(data:image/png;base64," + b64 + ")";
      }
    }).catch(function () {});
  }).catch(function () {
    setTimeout(loadActivePet, 500);
  });
}
loadActivePet();

// === BACKGROUND MANIFEST SYNC ===
// Fetch the manifest from petdex.dev on app launch and cache it in
// localStorage so the gallery opens instantly. Re-syncs every 30 min
// to pick up new pets while the app is running.
function startBackgroundSync() {
  syncManifestQuiet();
  setInterval(syncManifestQuiet, 30 * 60 * 1000);
}
  setInterval(syncManifestQuiet, 30 * 60 * 1000);
}

function syncManifestQuiet() {
  fetch("https://petdex.dev/api/manifest")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var fresh = (data.pets || []).map(function (p) {
        return {
          slug: p.slug,
          name: p.displayName || p.slug,
          kind: p.kind || "unknown",
          sprite: p.spritesheetUrl || "",
        };
      });
      // Only update + cache if something changed
      if (fresh.length !== allPets.length ||
          (fresh.length > 0 && fresh[0].slug !== (allPets[0] || {}).slug)) {
        allPets = fresh;
        manifestCacheTime = Date.now();
        try {
          localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(allPets));
          localStorage.setItem(MANIFEST_CACHE_TIME_KEY, String(manifestCacheTime));
        } catch (e) {}
        // If gallery is open, refresh it
        if (document.getElementById("gallery") &&
            document.getElementById("gallery").classList.contains("visible")) {
          galleryFiltered = filterByCategory(allPets);
          galleryShown = 0;
          renderGalleryPage();
        }
      } else {
        // Same count — just update the cache timestamp
        manifestCacheTime = Date.now();
        try {
          localStorage.setItem(MANIFEST_CACHE_TIME_KEY, String(manifestCacheTime));
        } catch (e) {}
      }
    })
    .catch(function () {
      // Network error — keep using cached data
    });
}

// Load cached manifest from localStorage at boot — INSTANT gallery access.
// The background sync refreshes it silently every 30 min.
try {
  var cached = localStorage.getItem(MANIFEST_CACHE_KEY);
  if (cached && cached.length > 100) {
    allPets = JSON.parse(cached);
    manifestCacheTime = parseInt(localStorage.getItem(MANIFEST_CACHE_TIME_KEY) || "0");
  }
} catch (e) {}

// Start background sync 5s after boot (doesn't block gallery — it uses cache)
setTimeout(startBackgroundSync, 5000);

// === ANIMATION STATES ===
var ROWS = {
  idle: { row: 0, frames: 6, dur: 1100 },
  "running-right": { row: 1, frames: 8, dur: 1060 },
  "running-left": { row: 2, frames: 8, dur: 1060 },
  waving: { row: 3, frames: 4, dur: 700 },
  jumping: { row: 4, frames: 5, dur: 840 },
  failed: { row: 5, frames: 8, dur: 1220 },
  waiting: { row: 6, frames: 6, dur: 1010 },
  running: { row: 7, frames: 6, dur: 820 },
  review: { row: 8, frames: 6, dur: 1030 },
};
var currentState = "idle";
function setState(s) {
  if (s === currentState) return;
  currentState = s;
  var r = ROWS[s] || ROWS.idle;
  var el = document.getElementById("sprite");
  el.style.setProperty("--sprite-row", r.row);
  el.style.setProperty("--sprite-frames", r.frames);
  el.style.setProperty("--sprite-duration", r.dur + "ms");
}
function showBubble(t) {
  var b = document.getElementById("bubble");
  b.textContent = t;
  b.classList.add("visible");
}
function hideBubble() {
  document.getElementById("bubble").classList.remove("visible");
}

// === PANEL MANAGEMENT ===
var normalSize = { w: 192, h: 288 };
function openPanel(name) {
  document.getElementById(name).classList.add("visible");
  // Gallery gets a much larger window; settings stays compact
  var sz = name === "gallery" ? { w: 1000, h: 800 } : { w: 480, h: 420 };
  if (window.__TAURI__) {
    var win = window.__TAURI__.window.getCurrentWindow();
    var LS = window.__TAURI__.core.LogicalSize;
    win
      .setSize(
        LS
          ? new LS(sz.w, sz.h)
          : { width: sz.w, height: sz.h, type: "Logical" },
      )
      .catch(() => {});
  }
  document.body.style.width = sz.w + "px";
  document.body.style.height = sz.h + "px";
  if (name === "gallery") loadGallery();
  if (name === "switcher") loadSwitcher();
}
function closePanel(name) {
  document.getElementById(name).classList.remove("visible");
  if (window.__TAURI__) {
    var win = window.__TAURI__.window.getCurrentWindow();
    var LS = window.__TAURI__.core.LogicalSize;
    win
      .setSize(
        LS
          ? new LS(normalSize.w, normalSize.h)
          : { width: normalSize.w, height: normalSize.h, type: "Logical" },
      )
      .catch(() => {});
  }
  document.body.style.width = normalSize.w + "px";
  document.body.style.height = normalSize.h + "px";
}

// === PET GALLERY (with caching, auto-sync, install/uninstall, categories) ===
var allPets = [];
var installedSlugs = new Set();
var galleryShown = 0;
var galleryFiltered = [];
var galleryObserver = null;
var PAGE = 24;
var spriteCache = {}; // slug -> blob URL, avoids re-fetching on re-render
var activeCategory = "all";
var manifestCache = null;
var manifestCacheTime = 0;

// localStorage key for manifest cache (survives across app restarts within
// the same WebView2 profile — much faster than re-fetching 3.8MB each time)
var MANIFEST_CACHE_KEY = "petdex_manifest_cache_v1";
var MANIFEST_CACHE_TIME_KEY = "petdex_manifest_cache_time_v1";
var CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function loadGallery() {
  var grid = document.getElementById("pet-grid");

  // 1. Load from localStorage cache IMMEDIATELY — render instantly.
  // allPets is already loaded from localStorage at boot (see startup code).
  // If it has data, show it RIGHT NOW without any network call.
  if (allPets.length > 0) {
    await refreshInstalled();
    galleryFiltered = filterByCategory(allPets);
    galleryShown = 0;
    renderGalleryPage();
    // Sync fresh data in background (silently, no loading indicator)
    syncManifestQuiet();
    return;
  }

  // 2. No cache at all — must fetch (first-ever open)
  grid.innerHTML = '<div class="loading">Fetching pets...</div>';
  await syncManifest();
}

async function syncManifest() {
  try {
    var r = await fetch("https://petdex.dev/api/manifest");
    var data = await r.json();
    allPets = (data.pets || []).map(function (p) {
      return {
        slug: p.slug,
        name: p.displayName || p.slug,
        kind: p.kind || "unknown",
        sprite: p.spritesheetUrl || "",
      };
    });
    manifestCacheTime = Date.now();
    // Cache to localStorage
    try {
      localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(allPets));
      localStorage.setItem(MANIFEST_CACHE_TIME_KEY, String(manifestCacheTime));
    } catch (e) {}
    // Re-render with fresh data
    await refreshInstalled();
    galleryFiltered = filterByCategory(allPets);
    galleryShown = 0;
    renderGalleryPage();
  } catch (e) {
    // If fetch failed and we have cached data, keep showing it
    if (allPets.length === 0) {
      var grid = document.getElementById("pet-grid");
      if (grid)
        grid.innerHTML =
          '<div class="loading">Failed to load. Check your internet.</div>';
    }
  }
}

function syncManifestQuiet() {
  // Silently fetch fresh data. No loading indicators, no blocking.
  // Only re-render if the data actually changed.
  fetch("https://petdex.dev/api/manifest")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var fresh = (data.pets || []).map(function (p) {
        return {
          slug: p.slug,
          name: p.displayName || p.slug,
          kind: p.kind || "unknown",
          sprite: p.spritesheetUrl || "",
        };
      });
      // Always update cache
      allPets = fresh;
      manifestCacheTime = Date.now();
      try {
        localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(allPets));
        localStorage.setItem(MANIFEST_CACHE_TIME_KEY, String(manifestCacheTime));
      } catch (e) {}
      // Re-render gallery if it's currently open
      if (document.getElementById("gallery") &&
          document.getElementById("gallery").classList.contains("visible")) {
        galleryFiltered = filterByCategory(allPets);
        galleryShown = 0;
        renderGalleryPage();
      }
    })
    .catch(function () {});
}

function filterByCategory(pets) {
  if (activeCategory === "all") return pets;
  return pets.filter(function (p) {
    return (p.kind || "unknown") === activeCategory;
  });
}

function setCategory(cat) {
  activeCategory = cat;
  galleryFiltered = filterByCategory(allPets);
  galleryShown = 0;
  renderGalleryPage();
  // Update tab styles
  var tabs = document.querySelectorAll(".cat-tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.remove("active");
    if (tabs[i].getAttribute("data-cat") === cat) tabs[i].classList.add("active");
  }
}

async function refreshInstalled() {
  if (!window.__TAURI__ || !window.__TAURI__.core) return;
  try {
    var pets = await window.__TAURI__.core.invoke("list_installed_pets");
    installedSlugs = new Set((pets || []).map(function (p) { return p.slug; }));
  } catch (e) {}
}

// Lazy-load sprites: only load when a card is scrolled into view.
// Uses IntersectionObserver to detect visibility. Sprites are fetched
// in parallel batches of 6 (to avoid overwhelming the browser's
// connection pool) and cached as blob URLs.
function lazyLoadSprite(p, inner) {
  if (spriteCache[p.slug]) {
    inner.style.backgroundImage = "url('" + spriteCache[p.slug] + "')";
    return;
  }
  // Mark as loading to prevent duplicate fetches
  spriteCache[p.slug] = "__loading__";
  fetch(p.sprite)
    .then(function (r) { return r.blob(); })
    .then(function (blob) {
      spriteCache[p.slug] = URL.createObjectURL(blob);
      inner.style.backgroundImage = "url('" + spriteCache[p.slug] + "')";
    })
    .catch(function () {
      spriteCache[p.slug] = null; // allow retry
    });
}

var spriteObserver = null;
function setupSpriteLazyLoad() {
  if (spriteObserver) spriteObserver.disconnect();
  spriteObserver = new IntersectionObserver(
    function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          var inner = entries[i].target;
          var slug = inner.dataset.slug;
          // Find the pet data
          for (var j = 0; j < allPets.length; j++) {
            if (allPets[j].slug === slug) {
              lazyLoadSprite(allPets[j], inner);
              break;
            }
          }
          spriteObserver.unobserve(inner);
        }
      }
    },
    { root: document.getElementById("gallery-scroll"), rootMargin: "200px", threshold: 0 }
  );
  // Observe all unrendered inner elements
  var inners = document.querySelectorAll(".pet-anim-inner[data-slug]");
  for (var k = 0; k < inners.length; k++) {
    if (!inners[k].style.backgroundImage) {
      spriteObserver.observe(inners[k]);
    }
  }
}

function renderGalleryPage() {
  var grid = document.getElementById("pet-grid");
  if (galleryShown === 0) grid.innerHTML = "";
  var end = Math.min(galleryShown + PAGE, galleryFiltered.length);
  var pagePets = galleryFiltered.slice(galleryShown, end);

  for (var i = 0; i < pagePets.length; i++) {
    (function (p) {
      var card = document.createElement("div");
      card.className = "pet-card";
      var anim = document.createElement("div");
      anim.className = "pet-anim";
      var inner = document.createElement("div");
      inner.className = "pet-anim-inner";
      inner.dataset.slug = p.slug;
      // Use cached sprite if available (from previous view)
      if (spriteCache[p.slug] && spriteCache[p.slug] !== "__loading__") {
        inner.style.backgroundImage = "url('" + spriteCache[p.slug] + "')";
      }
      anim.appendChild(inner);
      var nm = document.createElement("div");
      nm.className = "pname";
      nm.textContent = p.name;
      var sl = document.createElement("div");
      sl.className = "pslug";
      sl.textContent = p.slug;
      var btn = document.createElement("button");
      btn.className = "pet-btn";
      var isInstalled = installedSlugs.has(p.slug);
      btn.textContent = isInstalled ? "Uninstall" : "Install";
      btn.style.cssText = isInstalled ? "background:#e74c3c" : "background:#2ecc71";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        handleInstallToggle(p, btn);
      });
      card.appendChild(anim);
      card.appendChild(nm);
      card.appendChild(sl);
      card.appendChild(btn);
      grid.appendChild(card);
    })(pagePets[i]);
  }
  galleryShown = end;

  // Lazy-load sprites: only fetch sprites for cards visible in the viewport.
  // This makes the gallery render INSTANTLY (0 sprite downloads on page render).
  // Sprites load as the user scrolls, via IntersectionObserver.
  setupSpriteLazyLoad();
  var old = grid.querySelector(".sentinel");
  if (old) old.remove();
  if (galleryShown < galleryFiltered.length) {
    var sentinel = document.createElement("div");
    sentinel.className = "sentinel";
    sentinel.textContent =
      "Loading more... (" + galleryShown + "/" + galleryFiltered.length + ")";
    grid.appendChild(sentinel);
    if (galleryObserver) galleryObserver.disconnect();
    galleryObserver = new IntersectionObserver(
      function (entries) {
        if (entries[0].isIntersecting) renderGalleryPage();
      },
      { root: document.getElementById("gallery-scroll"), threshold: 0.1 },
    );
    galleryObserver.observe(sentinel);
  } else {
    var done = document.createElement("div");
    done.className = "sentinel";
    done.textContent = "All " + galleryFiltered.length + " pets shown";
    grid.appendChild(done);
  }
}

function handleInstallToggle(p, btn) {
  if (!window.__TAURI__ || !window.__TAURI__.core) return;
  var invoke = window.__TAURI__.core.invoke;
  if (installedSlugs.has(p.slug)) {
    // Uninstall
    btn.textContent = "Removing...";
    btn.style.background = "#888";
    invoke("uninstall_pet", { slug: p.slug })
      .then(function () {
        installedSlugs.delete(p.slug);
        btn.textContent = "Install";
        btn.style.background = "#2ecc71";
        showBubble("Removed " + p.slug);
      })
      .catch(function (e) {
        btn.textContent = "Uninstall";
        btn.style.background = "#e74c3c";
        showBubble("Uninstall failed");
      });
  } else {
    // Install
    btn.textContent = "Installing...";
    btn.style.background = "#888";
    invoke("install_pet", {
      slug: p.slug,
      spriteUrl: p.sprite,
      displayName: p.name,
    })
      .then(function () {
        installedSlugs.add(p.slug);
        btn.textContent = "Uninstall";
        btn.style.background = "#e74c3c";
        showBubble("Installed " + p.slug);
      })
      .catch(function (e) {
        btn.textContent = "Install";
        btn.style.background = "#2ecc71";
        showBubble("Install failed: " + String(e).slice(0, 30));
      });
  }
}

// === PET SWITCHER (switch between installed pets, deduplicated) ===
function loadSwitcher() {
  if (!window.__TAURI__ || !window.__TAURI__.core) return;
  var invoke = window.__TAURI__.core.invoke;
  var grid = document.getElementById("switcher-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Loading installed pets...</div>';
  invoke("list_installed_pets").then(function (pets) {
    grid.innerHTML = "";
    if (!pets || pets.length === 0) {
      grid.innerHTML =
        '<div class="loading">No pets installed. Use the gallery to install some.</div>';
      return;
    }
    // Deduplicate by slug (pet_roots checks both ~/.petdex/pets and ~/.codex/pets)
    var seen = {};
    var unique = [];
    for (var i = 0; i < pets.length; i++) {
      if (!seen[pets[i].slug]) {
        seen[pets[i].slug] = true;
        unique.push(pets[i]);
      }
    }
    var _loop_1 = function (p) {
      invoke("get_pet", { slug: p.slug }).then(function (meta) {
        if (!meta || !meta.sprite_path) return;
        invoke("read_file_as_base64", { path: meta.sprite_path }).then(function (b64) {
          var card = document.createElement("div");
          card.className = "pet-card";
          var anim = document.createElement("div");
          anim.className = "pet-anim";
          var inner = document.createElement("div");
          inner.className = "pet-anim-inner";
          inner.style.backgroundImage =
            "url(data:image/png;base64," + b64 + ")";
          anim.appendChild(inner);
          var nm = document.createElement("div");
          nm.className = "pname";
          nm.textContent = p.name;
          var sl = document.createElement("div");
          sl.className = "pslug";
          sl.textContent = p.slug;
          var btnRow = document.createElement("div");
          btnRow.style.cssText = "display:flex;gap:4px;margin-top:4px";
          var actBtn = document.createElement("button");
          actBtn.className = "pet-btn";
          actBtn.textContent = "Activate";
          actBtn.style.cssText = "flex:1;pointer-events:auto;position:relative;z-index:5";
          actBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            actBtn.textContent = "...";
            invoke("set_active_pet", { slug: p.slug })
              .then(function () {
                showBubble("Switched to " + p.name);
                closePanel("switcher");
                setTimeout(function () { loadActivePet(); }, 200);
              })
              .catch(function (err) {
                actBtn.textContent = "Activate";
                showBubble("Switch failed");
              });
          });
          var rmBtn = document.createElement("button");
          rmBtn.className = "pet-btn";
          rmBtn.textContent = "Remove";
          rmBtn.style.cssText = "flex:0 0 auto;background:#e74c3c;width:60px;pointer-events:auto;position:relative;z-index:5";
          rmBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
                        rmBtn.textContent = "...";
            invoke("uninstall_pet", { slug: p.slug })
              .then(function () {showBubble("Removed " + p.name);
                card.remove();
              })
              .catch(function (err) {
                if (label) label.textContent = "RM:ERR:" + String(err).slice(0, 20);
                rmBtn.textContent = "Remove";
                showBubble("Remove failed");
              });
          });
          btnRow.appendChild(actBtn);
          btnRow.appendChild(rmBtn);
          card.appendChild(anim);
          card.appendChild(nm);
          card.appendChild(sl);
          card.appendChild(btnRow);
          grid.appendChild(card);
        }).catch(function () {});
      }).catch(function () {});
    };
    for (var i = 0; i < unique.length; i++) {
      _loop_1(unique[i]);
    }
  }).catch(function (e) {
    grid.innerHTML = '<div class="loading">Failed to load pets.</div>';
  });
}

// === TAURI INIT (wire all buttons via addEventListener, NOT inline onclick) ===
function initTauri() {
  var t = window.__TAURI__;
  if (!t || !t.core) {
    setTimeout(initTauri, 100);
    return;
  }
  var invoke = t.core.invoke;
  
  // Quit button (red X)
  document.getElementById("quit").addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    invoke("quit_app");
  });
  // Right-click = quit
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    invoke("quit_app");
  });

  
  // Switch button (green swap icon)
  document.getElementById("switch-btn").addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      openPanel("switcher");},
    true,
  );

  // Switcher close button
  document
    .getElementById("switcher-close")
    .addEventListener("click", (e) => {
      e.stopPropagation();
      closePanel("switcher");
    });

  // Gallery button (blue eye) — use mouseup to survive drag-region capture
  document.getElementById("gallery-btn").addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      openPanel("gallery");},
    true,
  );
  document.getElementById("gallery-btn").addEventListener(
    "mouseup",
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      openPanel("gallery");
    },
    true,
  );

  // Category tabs in gallery
  var catTabs = document.querySelectorAll(".cat-tab");
  for (var ci = 0; ci < catTabs.length; ci++) {
    (function (tab) {
      tab.addEventListener("click", function (e) {
        e.stopPropagation();
        setCategory(tab.getAttribute("data-cat"));
      });
    })(catTabs[ci]);
  }

  // Middle-click = settings panel (merged with drag handler, no conflict)
  document.getElementById("root").addEventListener("auxclick", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      openPanel("settings");
    }
  });

  // Settings close button
  document.getElementById("settings-close").addEventListener("click", (e) => {
    e.stopPropagation();
    closePanel("settings");
  });

  // Gallery close button
  document.getElementById("gallery-close").addEventListener("click", (e) => {
    e.stopPropagation();
    closePanel("gallery");
  });

  // Search box — reset pagination + filter
  document.getElementById("pet-search").addEventListener("input", function () {
    var q = this.value.toLowerCase();
    galleryFiltered = allPets.filter(
      (p) =>
        p.slug.toLowerCase().indexOf(q) >= 0 ||
        p.name.toLowerCase().indexOf(q) >= 0,
    );
    galleryShown = 0;
    renderGalleryPage();
  });

  // Settings save
  document.getElementById("save-key").addEventListener("click", () => {
    var key = document.getElementById("or-key").value.trim();
    if (!key) {
      document.getElementById("key-status").textContent = "Key is empty.";
      return;
    }
    invoke("set_openrouter_key", { key: key })
      .then(() => {
        document.getElementById("key-status").textContent = "Saved locally!";
        document.getElementById("or-key").value = "";
      })
      .catch((err) => {
        document.getElementById("key-status").textContent =
          "Save failed: " + String(err).slice(0, 40);
      });
  });

  // Spawn sidecar
  invoke("spawn_sidecar").catch(() => {});

  // State polling
  var lastState = 0,
    lastBubble = 0;
  setInterval(() => {
    invoke("read_runtime_state")
      .then((d) => {
        if (d && d.counter !== lastState) {
          lastState = d.counter;
          if (d.state) setState(d.state);
        }
      })
      .catch(() => {});
  }, 200);
  setInterval(() => {
    invoke("read_runtime_bubble")
      .then((d) => {
        if (d && d.counter !== lastBubble) {
          lastBubble = d.counter;
          var b = document.getElementById("bubble");
          if (d.text) {
            b.textContent = d.text;
            b.classList.add("visible");
          } else {
            b.classList.remove("visible");
          }
        }
      })
      .catch(() => {});
  }, 200);

  // Command file polling — reads ~/.petdex/runtime/cmd.json via Rust invoke
  // every 500ms. If a new command is found, executes it and writes result
  // via write_cmd_result. Uses Tauri IPC (not fetch) to avoid CSP/mixed-content issues.
  var lastCmdId = 0;
  setInterval(() => {
    invoke("read_cmd_file")
      .then((cmd) => {
        if (!cmd || !cmd.id || cmd.id === lastCmdId) return;
        lastCmdId = cmd.id;
        var label = document.getElementById("label");
        function setResult(msg) {
          if (label) label.textContent = msg;
          invoke("write_cmd_result", { result: JSON.stringify({ id: cmd.id, result: msg }) }).catch(() => {});
        }

        if (cmd.action === "uninstall" && cmd.slug) {
          setResult("CMD:UNINST:" + cmd.slug);
          invoke("uninstall_pet", { slug: cmd.slug })
            .then(() => setResult("CMD:OK"))
            .catch((e) => setResult("CMD:ERR:" + String(e).slice(0, 20)));
        } else if (cmd.action === "list") {
          invoke("list_installed_pets").then((pets) => {
            setResult("CMD:LIST:" + (pets || []).map((p) => p.slug).join(","));
          }).catch((e) => setResult("CMD:LISTERR"));
        } else if (cmd.action === "switch" && cmd.slug) {
          invoke("set_active_pet", { slug: cmd.slug })
            .then(() => { setResult("CMD:SWITCH:OK"); loadActivePet(); })
            .catch((e) => setResult("CMD:SWITCH:ERR"));
        } else if (cmd.action === "openPanel" && cmd.panel) {
          openPanel(cmd.panel);
          setResult("CMD:PANEL:" + cmd.panel);
        } else if (cmd.action === "eval" && cmd.code) {
          try {
            var result = eval(cmd.code);
            setResult("CMD:EVAL:" + String(result).slice(0, 30));
          } catch (e) {
            setResult("CMD:EVALERR:" + String(e).slice(0, 20));
          }
        }
      })
      .catch(() => {});
  }, 500);
}
initTauri();
