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
  if (!window.__TAURI__ || !window.__TAURI__.core) {
    setTimeout(startBackgroundSync, 500);
    return;
  }
  // Initial sync on launch
  syncManifestQuiet();
  // Re-sync every 30 minutes
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

// Also try loading cached manifest immediately on boot (instant gallery)
try {
  var cachedTime = parseInt(localStorage.getItem(MANIFEST_CACHE_TIME_KEY) || "0");
  var cached = localStorage.getItem(MANIFEST_CACHE_KEY);
  if (cached && cachedTime > 0) {
    allPets = JSON.parse(cached);
    manifestCacheTime = cachedTime;
  }
} catch (e) {}

// Start background sync after a short delay (let loadActivePet go first)
setTimeout(startBackgroundSync, 2000);

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

  // 1. Try to load from localStorage cache FIRST (instant)
  try {
    var cachedTime = parseInt(localStorage.getItem(MANIFEST_CACHE_TIME_KEY) || "0");
    var cached = localStorage.getItem(MANIFEST_CACHE_KEY);
    if (cached && cachedTime > 0) {
      allPets = JSON.parse(cached);
      manifestCacheTime = cachedTime;
      var age = Date.now() - cachedTime;
      if (age < CACHE_TTL_MS) {
        // Cache is fresh — show immediately
        await refreshInstalled();
        galleryFiltered = filterByCategory(allPets);
        galleryShown = 0;
        renderGalleryPage();
        // Still sync in background for any new pets
        syncManifestInBackground();
        return;
      }
      // Cache is stale — show it while fetching fresh
      grid.innerHTML = '<div class="loading">Showing cached list. Syncing...</div>';
      await refreshInstalled();
      galleryFiltered = filterByCategory(allPets);
      galleryShown = 0;
      renderGalleryPage();
    } else {
      grid.innerHTML = '<div class="loading">Fetching pets...</div>';
    }
  } catch (e) {
    grid.innerHTML = '<div class="loading">Fetching pets...</div>';
  }

  // 2. Fetch fresh manifest
  await syncManifest();

  // 3. Render
  await refreshInstalled();
  galleryFiltered = filterByCategory(allPets);
  galleryShown = 0;
  renderGalleryPage();
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

function syncManifestInBackground() {
  // Silently fetch fresh data. Only re-render if pets count changed.
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
      if (fresh.length !== allPets.length) {
        allPets = fresh;
        manifestCacheTime = Date.now();
        try {
          localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(allPets));
          localStorage.setItem(MANIFEST_CACHE_TIME_KEY, String(manifestCacheTime));
        } catch (e) {}
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

// Preload sprites in parallel via fetch() + blob URLs (4-5x faster than
// sequential CSS background-image loading). Returns a map of slug→url.
function preloadSprites(pets) {
  var promises = pets.map(function (p) {
    if (spriteCache[p.slug]) return Promise.resolve(); // already cached
    return fetch(p.sprite)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        spriteCache[p.slug] = URL.createObjectURL(blob);
      })
      .catch(function () {}); // skip failed sprites
  });
  return Promise.all(promises);
}

function renderGalleryPage() {
  var grid = document.getElementById("pet-grid");
  if (galleryShown === 0) grid.innerHTML = "";
  var end = Math.min(galleryShown + PAGE, galleryFiltered.length);
  var pagePets = galleryFiltered.slice(galleryShown, end);

  // Show placeholder cards immediately, then preload sprites in parallel
  var cards = [];
  for (var i = 0; i < pagePets.length; i++) {
    (function (p) {
      var card = document.createElement("div");
      card.className = "pet-card";
      var anim = document.createElement("div");
      anim.className = "pet-anim";
      var inner = document.createElement("div");
      inner.className = "pet-anim-inner";
      inner.dataset.slug = p.slug;
      // Use cached sprite if available, otherwise show placeholder
      if (spriteCache[p.slug]) {
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
      cards.push({ slug: p.slug, inner: inner });
    })(pagePets[i]);
  }
  galleryShown = end;

  // Preload all sprites for this page in parallel (4-5x faster)
  preloadSprites(pagePets).then(function () {
    for (var ci = 0; ci < cards.length; ci++) {
      var c = cards[ci];
      if (spriteCache[c.slug]) {
        c.inner.style.backgroundImage = "url('" + spriteCache[c.slug] + "')";
      }
    }
  });
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
          var btn = document.createElement("button");
          btn.className = "pet-btn";
          btn.textContent = "Activate";
          btn.addEventListener("click", function (e) {
            e.stopPropagation();
            btn.textContent = "Switching...";
            invoke("set_active_pet", { slug: p.slug })
              .then(function () {
                showBubble("Switched to " + p.name);
                closePanel("switcher");
                setTimeout(function () { loadActivePet(); }, 200);
              })
              .catch(function (err) {
                btn.textContent = "Activate";
                showBubble("Switch failed: " + String(err).slice(0, 30));
              });
          });
          card.appendChild(anim);
          card.appendChild(nm);
          card.appendChild(sl);
          card.appendChild(btn);
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
      openPanel("switcher");
    },
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
      openPanel("gallery");
    },
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
}
initTauri();
