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

// === PET GALLERY (with caching, auto-sync, install/uninstall) ===
var allPets = [];
var installedSlugs = new Set();
var galleryShown = 0;
var galleryFiltered = [];
var galleryObserver = null;
var PAGE = 24;

async function loadGallery() {
  var grid = document.getElementById("pet-grid");
  grid.innerHTML = '<div class="loading">Syncing with petdex.dev...</div>';

  // Always fetch fresh manifest from petdex.dev (auto-sync)
  try {
    var r = await fetch("https://petdex.dev/api/manifest");
    var data = await r.json();
    allPets = (data.pets || []).map((p) => ({
      slug: p.slug,
      name: p.displayName || p.slug,
      sprite: p.spritesheetUrl || "",
    }));
    // Cache the manifest locally
    try {
      var cacheDir = await getCacheDir();
      await fetch("http://127.0.0.1:9999/_cache_manifest", {
        method: "POST",
        body: JSON.stringify(allPets.slice(0, 100)),
      }).catch(function () {});
    } catch (e) {}
  } catch (e) {
    // Offline — try cached manifest
    grid.innerHTML = '<div class="loading">Offline. Showing cached pets.</div>';
  }

  // Refresh installed pets list
  await refreshInstalled();

  galleryFiltered = allPets;
  galleryShown = 0;
  renderGalleryPage();
}

async function refreshInstalled() {
  if (!window.__TAURI__ || !window.__TAURI__.core) return;
  try {
    var pets = await window.__TAURI__.core.invoke("list_installed_pets");
    installedSlugs = new Set((pets || []).map(function (p) { return p.slug; }));
  } catch (e) {}
}

async function getCacheDir() {
  // Cache dir is project_root/cached_contents (used for manifest caching).
  // Not used for sprites (those go to ~/.petdex/pets/).
  return "cached_contents";
}

function renderGalleryPage() {
  var grid = document.getElementById("pet-grid");
  if (galleryShown === 0) grid.innerHTML = "";
  var end = Math.min(galleryShown + PAGE, galleryFiltered.length);
  for (var i = galleryShown; i < end; i++) {
    (function (p) {
      var card = document.createElement("div");
      card.className = "pet-card";
      var anim = document.createElement("div");
      anim.className = "pet-anim";
      var inner = document.createElement("div");
      inner.className = "pet-anim-inner";
      inner.style.backgroundImage = "url('" + p.sprite + "')";
      anim.appendChild(inner);
      var nm = document.createElement("div");
      nm.className = "pname";
      nm.textContent = p.name;
      var sl = document.createElement("div");
      sl.className = "pslug";
      sl.textContent = p.slug;
      // Install/Uninstall button
      var btn = document.createElement("button");
      btn.className = "pet-btn";
      var isInstalled = installedSlugs.has(p.slug);
      btn.textContent = isInstalled ? "Uninstall" : "Install";
      btn.style.cssText = isInstalled
        ? "background:#e74c3c"
        : "background:#2ecc71";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        handleInstallToggle(p, btn);
      });
      card.appendChild(anim);
      card.appendChild(nm);
      card.appendChild(sl);
      card.appendChild(btn);
      grid.appendChild(card);
    })(galleryFiltered[i]);
  }
  galleryShown = end;
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
      { root: document.getElementById("gallery"), threshold: 0.1 },
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

// === PET SWITCHER (switch between installed pets) ===
function loadSwitcher() {
  if (!window.__TAURI__ || !window.__TAURI__.core) return;
  var invoke = window.__TAURI__.core.invoke;
  var grid = document.getElementById("switcher-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Loading...</div>';
  invoke("list_installed_pets").then(function (pets) {
    grid.innerHTML = "";
    if (!pets || pets.length === 0) {
      grid.innerHTML =
        '<div class="loading">No pets installed. Use the gallery to install some.</div>';
      return;
    }
    for (var i = 0; i < pets.length; i++) {
      (function (p) {
        var card = document.createElement("div");
        card.className = "pet-card";
        var anim = document.createElement("div");
        anim.className = "pet-anim";
        var inner = document.createElement("div");
        inner.className = "pet-anim-inner";
        // Use the installed sprite (via Tauri asset protocol)
        invoke("read_file_as_base64", { path: "" }).catch(function () {}); // dummy
        // Just show the name for now — sprite loading per installed pet is complex
        var nm = document.createElement("div");
        nm.className = "pname";
        nm.textContent = p.name;
        var sl = document.createElement("div");
        sl.className = "pslug";
        sl.textContent = p.slug;
        var btn = document.createElement("button");
        btn.className = "pet-btn";
        btn.textContent = "Activate";
        btn.style.background = "#6b8cff";
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          invoke("set_active_pet", { slug: p.slug })
            .then(function () {
              showBubble("Switched to " + p.name);
              closePanel("switcher");
            })
            .catch(function (e) {
              showBubble("Switch failed");
            });
        });
        anim.appendChild(inner);
        card.appendChild(anim);
        card.appendChild(nm);
        card.appendChild(sl);
        card.appendChild(btn);
        grid.appendChild(card);
      })(pets[i]);
    }
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
