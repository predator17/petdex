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

// === PET GALLERY ===
var allPets = [];
var galleryShown = 0;
var galleryFiltered = [];
var galleryObserver = null;
var PAGE = 24;
function loadGallery() {
  if (allPets.length > 0) {
    galleryFiltered = allPets;
    galleryShown = 0;
    renderGalleryPage();
    return;
  }
  var grid = document.getElementById("pet-grid");
  grid.innerHTML = '<div class="loading">Fetching 3700+ pets...</div>';
  fetch("https://petdex.dev/api/manifest")
    .then((r) => r.json())
    .then((data) => {
      allPets = (data.pets || []).map((p) => ({
        slug: p.slug,
        name: p.displayName || p.slug,
        sprite: p.spritesheetUrl || "",
      }));
      galleryFiltered = allPets;
      galleryShown = 0;
      renderGalleryPage();
    })
    .catch((e) => {
      grid.innerHTML =
        '<div class="loading">Failed to load. Check your internet.</div>';
    });
}
function renderGalleryPage() {
  var grid = document.getElementById("pet-grid");
  if (galleryShown === 0) grid.innerHTML = "";
  var end = Math.min(galleryShown + PAGE, galleryFiltered.length);
  for (var i = galleryShown; i < end; i++) {
    ((p) => {
      var card = document.createElement("div");
      card.className = "pet-card";
      var anim = document.createElement("div");
      anim.className = "pet-anim";
      var inner = document.createElement("div");
      inner.className = "pet-anim-inner";
      inner.style.backgroundImage = "url('" + p.sprite + "')";
      inner.onerror = () => {
        inner.style.background = "#333";
      };
      anim.appendChild(inner);
      var nm = document.createElement("div");
      nm.className = "pname";
      nm.textContent = p.name;
      var sl = document.createElement("div");
      sl.className = "pslug";
      sl.textContent = p.slug;
      card.appendChild(anim);
      card.appendChild(nm);
      card.appendChild(sl);
      grid.appendChild(card);
    })(galleryFiltered[i]);
  }
  galleryShown = end;
  // Remove old sentinel
  var old = grid.querySelector(".sentinel");
  if (old) old.remove();
  // Add sentinel for infinite scroll if more remain
  if (galleryShown < galleryFiltered.length) {
    var sentinel = document.createElement("div");
    sentinel.className = "sentinel";
    sentinel.textContent =
      "Loading more... (" + galleryShown + "/" + galleryFiltered.length + ")";
    grid.appendChild(sentinel);
    if (galleryObserver) galleryObserver.disconnect();
    galleryObserver = new IntersectionObserver(
      (entries) => {
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
