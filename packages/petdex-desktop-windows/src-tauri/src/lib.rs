use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WindowEvent};

// Bring in the Windows-only CommandExt trait so we can set creation_flags.
#[cfg(windows)]
use std::os::windows::process::CommandExt;

// Win32 transparency/click-through (plan §4.4). Windows-only module.
#[cfg(windows)]
mod transparency;

// ── Drag tracker (Rust-side, survives JS freeze) ────────────────────────────
// data-tauri-drag-region freezes the JS event loop during drag, so JS can't
// measure direction/speed. Instead, Rust tracks window position changes via
// the on_window_event Moved callback and records the drag result. JS polls
// get_drag_result() after release to get the direction + speed.
#[derive(Debug, Clone, Default)]
struct DragTracker {
    /// Position before the last drag started
    start_x: i32,
    start_y: i32,
    /// Position after the last drag ended
    end_x: i32,
    end_y: i32,
    /// Net horizontal movement (positive = right)
    dx: i32,
    /// Net vertical movement
    dy: i32,
    /// Total distance moved
    dist: f64,
    /// Timestamp when drag started (ms)
    start_t: u64,
    /// Timestamp of last position update (ms)
    last_t: u64,
    /// True if the window has moved since last reset
    moved: bool,
    /// Monotonically increasing ID — JS compares to detect new drags
    drag_id: u32,
}

// ── Pet types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PetMeta {
    pub slug: String,
    pub name: String,
    pub sprite_path: String,
}

// ── Sidecar state ─────────────────────────────────────────────────────────────

pub struct SidecarState {
    pub child: Option<std::process::Child>,
    pub port: u16,
    pub token: String,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self { child: None, port: 0, token: String::new() }
    }
}

// ── Pet scanner ───────────────────────────────────────────────────────────────

/// Spritesheet size cap — mirrors MAX_PET_BYTES in main.zig (16 MiB).
/// Keeps listing behaviour in lockstep with the loader: a pet that
/// would be rejected at load time is also excluded from the listing.
const MAX_PET_BYTES: u64 = 16 * 1024 * 1024;

fn pet_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".petdex").join("pets"));
        roots.push(home.join(".codex").join("pets"));
    }
    roots
}

/// Canonicalize `p` and strip the Windows verbatim prefix `\\?\` so that
/// `starts_with` comparisons work correctly on all platforms.
/// On non-Windows (and when canonicalization fails) returns the path as-is.
fn canonical_normalize(p: &std::path::Path) -> PathBuf {
    match fs::canonicalize(p) {
        Ok(c) => {
            let s = c.to_string_lossy();
            if let Some(stripped) = s.strip_prefix(r"\\?\") {
                PathBuf::from(stripped.to_string())
            } else {
                c
            }
        }
        Err(_) => p.to_path_buf(),
    }
}

/// Returns the path of the first valid sprite file found in `pet_dir`.
/// Valid means: regular non-empty file, within MAX_PET_BYTES, one of the known extensions.
/// pet.json is NOT required — the sprite file is the authoritative marker.
fn find_valid_sprite(pet_dir: &std::path::Path) -> Option<PathBuf> {
    for name in &[
        "spritesheet.webp",
        "spritesheet.png",
        "sprite.webp",
        "sprite.png",
    ] {
        let p = pet_dir.join(name);
        if let Ok(meta) = fs::metadata(&p) {
            if meta.is_file() && meta.len() > 0 && meta.len() <= MAX_PET_BYTES {
                return Some(p);
            }
        }
    }
    None
}

fn load_pet_from_dir(slug: &str, dir: &std::path::Path) -> Option<PetMeta> {
    let pet_dir = dir.join(slug);

    // Sprite file is required; no valid sprite → this slug is not a usable pet.
    let sprite_path = find_valid_sprite(&pet_dir)?;

    // pet.json is best-effort: missing or malformed falls back to slug as name.
    let name = fs::read_to_string(pet_dir.join("pet.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|val| {
            val.get("displayName")
                .or_else(|| val.get("name"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| slug.to_string());

    Some(PetMeta {
        slug: slug.to_string(),
        name,
        sprite_path: sprite_path.to_string_lossy().to_string(),
    })
}
/// Download a pet sprite from a URL and install it to ~/.petdex/pets/<slug>/.
/// Called from the gallery's install button. Downloads the sprite + pet.json.
#[tauri::command]
async fn install_pet(slug: String, sprite_url: String, display_name: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("no home")?;
    let pet_dir = home.join(".petdex").join("pets").join(&slug);
    fs::create_dir_all(&pet_dir).map_err(|e| format!("mkdir: {e}"))?;

    // Download sprite via async reqwest
    let resp = reqwest::get(&sprite_url).await.map_err(|e| format!("download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let body = resp.bytes().await.map_err(|e| format!("read body: {e}"))?;
    fs::write(pet_dir.join("spritesheet.webp"), &body).map_err(|e| format!("write sprite: {e}"))?;

    // Write pet.json
    let pet_json = serde_json::json!({
        "id": slug,
        "displayName": display_name,
        "description": "",
        "spritesheetPath": "spritesheet.webp"
    });
    fs::write(pet_dir.join("pet.json"), serde_json::to_string_pretty(&pet_json).unwrap())
        .map_err(|e| format!("write pet.json: {e}"))?;

    Ok(())
}

/// Remove a pet from any root that contains it (~/.petdex/pets and ~/.codex/pets).
#[tauri::command]
fn uninstall_pet(slug: String) -> Result<(), String> {
    let mut removed = false;
    for root in pet_roots() {
        let pet_dir = root.join(&slug);
        if pet_dir.exists() {
            fs::remove_dir_all(&pet_dir).map_err(|e| format!("remove: {e}"))?;
            removed = true;
        }
    }
    if !removed {
        return Err(format!("pet '{}' not installed", slug));
    }

    // If this was the active pet, clear active.json
    let home = dirs::home_dir().ok_or("no home")?;
    let active_path = home.join(".petdex").join("active.json");
    if let Ok(active) = fs::read_to_string(&active_path) {
        if active.contains(&slug) {
            let _ = fs::write(&active_path, "{}");
        }
    }
    Ok(())
}

/// Return list of installed pet slugs + display names.
#[derive(Serialize)]
struct InstalledPet {
    slug: String,
    name: String,
}

#[tauri::command]
fn list_installed_pets() -> Vec<InstalledPet> {
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for root in pet_roots() {
        if let Ok(entries) = fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && find_valid_sprite(&path).is_some() {
                    let slug = entry.file_name().to_string_lossy().to_string();
                    // Deduplicate: skip if we already saw this slug from
                    // another root (e.g. ~/.codex/pets is a fallback for
                    // ~/.petdex/pets and may contain the same pet).
                    if seen.contains(&slug) { continue; }
                    seen.insert(slug.clone());
                    let name = fs::read_to_string(path.join("pet.json"))
                        .ok()
                        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                        .and_then(|v| v.get("displayName").or_else(|| v.get("name")).and_then(|n| n.as_str()).map(|s| s.to_string()))
                        .unwrap_or_else(|| slug.clone());
                    result.push(InstalledPet { slug, name });
                }
            }
        }
    }
    result
}

/// Read the active slug from ~/.petdex/active.json ({"slug":"<slug>"}).
/// Returns None if the file is absent, unreadable, or malformed.
fn read_active_slug() -> Option<String> {
    let path = dirs::home_dir()?.join(".petdex").join("active.json");
    let raw = fs::read_to_string(&path).ok()?;
    let val: serde_json::Value = serde_json::from_str(&raw).ok()?;
    val.get("slug").and_then(|v| v.as_str()).map(|s| s.to_string())
}

/// Write the active slug to ~/.petdex/active.json. Called from the picker
/// (plan §4.5). Validates the slug resolves to an installed pet before
/// writing so the file can never point at a missing pet.
#[tauri::command]
fn set_active_pet(slug: String) -> Result<(), String> {
    // Confirm the slug is a real installed pet before committing.
    if get_pet(slug.clone()).is_none() {
        return Err(format!("pet '{}' is not installed", slug));
    }
    let home = dirs::home_dir().ok_or("no home directory")?;
    let path = home.join(".petdex").join("active.json");
    let body = serde_json::json!({ "slug": slug }).to_string();
    fs::write(&path, body).map_err(|e| format!("write failed: {e}"))
}

/// Write the user's OpenRouter API key to the local key store
/// (~/.petdex/runtime/openrouter-key) with owner-only permissions.
/// Called from the Settings panel (plan §4.5 + §5.7 #1). The key stays
/// on this machine — the sidecar reads it for POST /generate, the web
/// backend never sees it. We never log or echo the key value.
#[tauri::command]
fn set_openrouter_key(key: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("no home directory")?;
    let dir = home.join(".petdex").join("runtime");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let path = dir.join("openrouter-key");
    fs::write(&path, key.trim()).map_err(|e| format!("write failed: {e}"))?;
    // Tighten to owner-only. On Windows, icacls disables inheritance and
    // grants only the current owner; on POSIX, chmod 0600. DPAPI-at-rest
    // is the documented follow-up; owner-only is the v1 minimum.
    restrict_file_owner(&path);
    Ok(())
}

/// Best-effort owner-only file protection (plan §5.7 #1). Mirrors the
/// sidecar's ensureKeyStoreOwnerOnly. A failure is non-fatal (the file is
/// already written); we surface nothing about it to avoid leaking the path
/// in error strings that might be logged.
fn restrict_file_owner(path: &std::path::Path) {
    #[cfg(windows)]
    {
        use std::process::Command;
        let user = std::env::var("USERNAME").unwrap_or_default();
        if user.is_empty() {
            return;
        }
        let _ = Command::new("icacls")
            .arg(path)
            .args(["/inheritance:r", "/grant:r", &format!("{user}:F")])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

// ── Sidecar helpers ───────────────────────────────────────────────────────────

/// Resolve the node executable — tries common install locations so we work
/// even when app.exe inherits a PATH that doesn't include nodejs.
///
/// A GUI app does not inherit a shell's PATH, so `where node` frequently
/// fails for users who installed node via a version manager (nvm-windows,
/// scoop, fnm, volta) rather than the official installer. We therefore
/// probe the well-known per-manager paths in addition to the two Program
/// Files locations and `where.exe` (plan §4.7).
fn find_node() -> PathBuf {
    // Try PATH first (works in dev when launched from a node-aware shell)
    if let Ok(out) = std::process::Command::new("where.exe").arg("node").output() {
        if out.status.success() {
            if let Ok(s) = std::str::from_utf8(&out.stdout) {
                if let Some(line) = s.lines().next() {
                    let p = PathBuf::from(line.trim());
                    if p.exists() { return p; }
                }
            }
        }
    }

    // Collect candidate paths from the common Windows node managers.
    // Each manager installs node into a predictable, env-derived location:
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Official installer (also the nvm-windows symlink target).
    candidates.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
    candidates.push(PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"));

    let user_profile = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir());
    let app_data = std::env::var_os("APPDATA").map(PathBuf::from);
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);

    if let Some(home) = &user_profile {
        // nvm-windows: %NVM_HOME% (usually %APPDATA%\nvm) and the symlink
        // %NVM_SYMLINK% (usually C:\Program Files\nodejs, covered above).
        if let Some(nvm_home) = std::env::var_os("NVM_HOME").map(PathBuf::from) {
            candidates.push(nvm_home.join("node.exe"));
        }
        // scoop: shims live under %USERPROFILE%\scoop\shims
        candidates.push(home.join("scoop").join("shims").join("node.exe"));
        // volta: %USERPROFILE%\.volta\bin
        candidates.push(home.join(".volta").join("bin").join("node.exe"));
    }

    // nvm-windows also installs under %APPDATA%\nvm (the default NVM_HOME).
    if let Some(appdata) = &app_data {
        candidates.push(appdata.join("nvm").join("node.exe"));
    }

    // fnm stores multishells under %LOCALAPPDATA%\fnm_multishells; the
    // active node is a junction resolved via `fnm env`, but probing the
    // multishell dir for a node.exe is a reasonable last-resort heuristic.
    if let Some(local) = &local_app_data {
        candidates.push(local.join("fnm_multishells").join("node.exe"));
    }

    for candidate in &candidates {
        if candidate.exists() {
            return candidate.clone();
        }
    }
    // Final fallback — let OS resolve it
    PathBuf::from("node")
}

fn find_sidecar_js() -> Option<PathBuf> {
    // Production install path (set by `petdex install desktop`)
    if let Some(home) = dirs::home_dir() {
        let installed = home.join(".petdex").join("sidecar").join("server.js");
        if installed.exists() {
            return Some(installed);
        }
    }
    // Dev/CI override — set PETDEX_SIDECAR_PATH to the absolute path of server.js
    if let Ok(env_path) = std::env::var("PETDEX_SIDECAR_PATH") {
        let p = PathBuf::from(&env_path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Port is fixed at 7777 (or PETDEX_PORT env var).
/// Token is written by the sidecar to ~/.petdex/runtime/update-token as plain text.
fn read_runtime_info() -> Option<(u16, String)> {
    let port: u16 = std::env::var("PETDEX_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(7777);

    let token_path = dirs::home_dir()?
        .join(".petdex")
        .join("runtime")
        .join("update-token");

    let token = if token_path.exists() {
        fs::read_to_string(&token_path)
            .ok()
            .map(|t| t.trim().to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    Some((port, token))
}

// ── Tauri commands — pet ──────────────────────────────────────────────────────

/// Return the slugs of all pets that have a valid spritesheet.
/// pet.json is not required — sprite presence is the authoritative check.
#[tauri::command]
fn list_pets() -> Vec<String> {
    let mut slugs = Vec::new();
    for root in pet_roots() {
        if let Ok(entries) = fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && find_valid_sprite(&path).is_some() {
                    if let Some(name) = entry.file_name().to_str() {
                        slugs.push(name.to_string());
                    }
                }
            }
        }
    }
    slugs.sort();
    slugs.dedup();
    slugs
}

/// Load metadata for a specific pet by slug; returns None if not installed.
#[tauri::command]
fn get_pet(slug: String) -> Option<PetMeta> {
    for root in pet_roots() {
        if let Some(meta) = load_pet_from_dir(&slug, &root) {
            return Some(meta);
        }
    }
    None
}

/// Return the active pet: reads ~/.petdex/active.json first, then iterates
/// all pet roots in order until one loads. Mirrors main.zig's startup logic.
#[tauri::command]
fn get_active_pet() -> Option<PetMeta> {
    if let Some(slug) = read_active_slug() {
        if let Some(meta) = get_pet(slug) {
            return Some(meta);
        }
    }
    // Fallback: first loadable pet across all roots in alphabetical order.
    for root in pet_roots() {
        if let Ok(entries) = fs::read_dir(&root) {
            let mut slugs: Vec<String> = entries
                .flatten()
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
                .collect();
            slugs.sort();
            for slug in slugs {
                if let Some(meta) = load_pet_from_dir(&slug, &root) {
                    return Some(meta);
                }
            }
        }
    }
    None
}

/// Read a spritesheet and return its contents as a base64 string.
///
/// Security restrictions (both must hold):
///   1. Canonical path must be inside one of the known pet roots
///      (~/.petdex/pets/ or ~/.codex/pets/). This closes the path-traversal
///      window: JS in the WebView cannot escape to arbitrary files.
///   2. File size must be ≤ MAX_PET_BYTES (16 MiB). Mirrors the loader
///      cap in main.zig so an oversized spritesheet can't crash the renderer.
///
/// Uses canonical_normalize to strip the Windows \\?\ verbatim prefix so
/// the starts_with comparison against pet_roots() works correctly.
#[tauri::command]
fn read_file_as_base64(path: String) -> Result<String, String> {
    use std::io::Read;
    let canonical = canonical_normalize(std::path::Path::new(&path));
    let in_pet_root = pet_roots().iter().any(|r| {
        let root = canonical_normalize(r);
        canonical.starts_with(&root)
    });
    if !in_pet_root {
        return Err(format!(
            "path is outside allowed pet directories: {}",
            canonical.display()
        ));
    }
    let meta = fs::metadata(&canonical)
        .map_err(|e| format!("cannot stat file: {e}"))?;
    if meta.len() == 0 {
        return Err("file is empty".into());
    }
    if meta.len() > MAX_PET_BYTES {
        return Err(format!(
            "file too large ({} bytes, cap {} bytes)",
            meta.len(),
            MAX_PET_BYTES
        ));
    }
    let mut f = fs::File::open(&canonical)
        .map_err(|e| format!("cannot open file: {e}"))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)
        .map_err(|e| format!("read failed: {e}"))?;
    Ok(base64_encode(&buf))
}

fn base64_encode(input: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 63) as usize] as char);
        out.push(CHARS[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { CHARS[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { CHARS[(n & 63) as usize] as char } else { '=' });
    }
    out
}

// ── Tauri commands — runtime file reads ──────────────────────────────────────

/// Read the sidecar state from ~/.petdex/runtime/state.json.
///
/// The sidecar writes this file on every state change (not on a timer), so
/// reading it directly is both lower-latency and CORS-free compared to
/// fetching from the sidecar's HTTP server from inside the WebView.
/// Returns None if the file is absent, unreadable, or not valid JSON.
#[tauri::command]
fn read_runtime_state() -> Option<serde_json::Value> {
    let path = dirs::home_dir()?
        .join(".petdex")
        .join("runtime")
        .join("state.json");
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Read the sidecar bubble from ~/.petdex/runtime/bubble.json.
///
/// Same rationale as read_runtime_state: file-based reads sidestep
/// the CORS issue that blocks cross-origin fetch() inside WebView2.
/// Returns None if the file is absent, unreadable, or not valid JSON.
#[tauri::command]
fn read_runtime_bubble() -> Option<serde_json::Value> {
    let path = dirs::home_dir()?
        .join(".petdex")
        .join("runtime")
        .join("bubble.json");
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Read ~/.petdex/runtime/cmd.json. Returns the parsed JSON or {id:0}.
#[tauri::command]
fn read_cmd_file() -> Option<serde_json::Value> {
    let path = dirs::home_dir()?.join(".petdex").join("runtime").join("cmd.json");
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Write ~/.petdex/runtime/cmd-result.json.
#[tauri::command]
fn write_cmd_result(result: String) -> Result<(), String> {
    let path = dirs::home_dir()
        .ok_or("no home")?
        .join(".petdex")
        .join("runtime")
        .join("cmd-result.json");
    fs::write(&path, result).map_err(|e| format!("{e}"))
}

/// Execute JavaScript in the WebView2 page. Used for testing UI interactions
/// (button clicks, panel opens) without needing real mouse events, which
/// can't be reliably sent to WebView2 from outside the process.
#[tauri::command]
fn eval_js(app: tauri::AppHandle, code: String) -> Result<(), String> {
    use tauri::Manager;
    let main = app.get_webview_window("pet").ok_or("no window")?;
    main.eval(&code).map_err(|e| format!("{e}"))
}

// ── Tauri commands — sidecar ──────────────────────────────────────────────────

/// Spawn the sidecar server; kill any stale instance first. Returns the port (default 7777).
#[tauri::command]
fn spawn_sidecar(state: State<Mutex<SidecarState>>) -> Result<u16, String> {
    let sidecar_path = find_sidecar_js()
        .ok_or_else(|| "sidecar server.js not found in ~/.petdex/sidecar/ or repo".to_string())?;

    // Kill any stale sidecar first so port 7777 is free
    {
        let mut s = state.lock().unwrap();
        if let Some(mut old) = s.child.take() {
            let _ = old.kill();
        }
    }

    let node = find_node();
    let mut cmd = std::process::Command::new(&node);
    cmd.arg(&sidecar_path)
        // Tell the sidecar our PID so its parent-watchdog can exit cleanly
        // when this desktop process terminates. Mirrors main.zig line 1086.
        .env("PETDEX_PARENT_PID", std::process::id().to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    // Prevent a console window from appearing when node is spawned from a
    // Windows GUI subsystem process (CREATE_NO_WINDOW = 0x08000000).
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar (node={:?}): {e}", node))?;

    let (port, token) = read_runtime_info()
        .ok_or_else(|| "could not determine port/token".to_string())?;

    let mut s = state.lock().unwrap();
    s.child = Some(child);
    s.port = port;
    s.token = token;

    // Return port immediately — JS polls /health until sidecar is ready
    Ok(port)
}

/// Return the port the sidecar is currently listening on (0 if not running).
#[tauri::command]
fn get_sidecar_port(state: State<Mutex<SidecarState>>) -> u16 {
    state.lock().unwrap().port
}

/// Kill the sidecar process and clear its port/token from state.
#[tauri::command]
fn stop_sidecar(state: State<Mutex<SidecarState>>) {
    let mut s = state.lock().unwrap();
    if let Some(mut child) = s.child.take() {
        let _ = child.kill();
    }
    s.port = 0;
    s.token = String::new();
}

/// Return the last drag result: direction, distance, speed, and a
/// monotonically increasing drag_id. JS polls this every 100ms; when
/// drag_id changes, a new drag was detected.
#[derive(Serialize)]
struct DragResult {
    drag_id: u32,
    dx: i32,
    dy: i32,
    dist: f64,
    speed: f64,
    direction: String,
    moved: bool,
}

#[tauri::command]
fn get_drag_result(app: tauri::AppHandle) -> Result<DragResult, String> {
    let tracker = app.state::<Mutex<DragTracker>>();
    let t = tracker.lock().unwrap();
    let dx = t.end_x - t.start_x;
    let dy = t.end_y - t.start_y;
    let dist = ((dx * dx + dy * dy) as f64).sqrt();
    let direction = if dx.abs() > dy.abs() {
        if dx > 5 { "right".into() }
        else if dx < -5 { "left".into() }
        else { "none".into() }
    } else {
        if dy > 5 { "down".into() }
        else if dy < -5 { "up".into() }
        else { "none".into() }
    };
    let elapsed_ms = t.last_t.saturating_sub(t.start_t).max(1);
    let speed = dist / (elapsed_ms as f64);
    Ok(DragResult {
        drag_id: t.drag_id,
        dx,
        dy,
        dist,
        speed,
        direction,
        moved: t.moved,
    })
}

/// Called by JS after it has processed a drag result. Resets the tracker
/// for the next drag and records the CURRENT window position as the start
/// position for the next drag (so the first Moved event doesn't overwrite
/// it with an already-moved position).
#[tauri::command]
fn reset_drag(app: tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("pet").ok_or("no window")?;
    let cur = main.outer_position().map_err(|e| format!("{e}"))?;
    let tracker = app.state::<Mutex<DragTracker>>();
    let mut t = tracker.lock().unwrap();
    t.drag_id += 1;
    t.moved = false;
    t.dx = 0;
    t.dy = 0;
    t.dist = 0.0;
    // Record current position as the start for the NEXT drag
    t.start_x = cur.x;
    t.start_y = cur.y;
    t.end_x = cur.x;
    t.end_y = cur.y;
    Ok(())
}

// ── Tauri commands — app ──────────────────────────────────────────────────────

/// Exit the application cleanly (triggered by right-click).
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(SidecarState::default()))
        .manage(Mutex::new(DragTracker::default()))
        // Deep-link plugin (plan §4.5): registers the `petdex://` scheme.
        .plugin(tauri_plugin_deep_link::init())
        .on_window_event(|window, event| {
            // Track window position changes for drag detection.
            // Rust gets these events even when JS is frozen by the OS drag.
            if let WindowEvent::Moved(pos) = event {
                let app = window.app_handle();
                let tracker = app.state::<Mutex<DragTracker>>();
                let mut t = tracker.lock().unwrap();
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;

                if !t.moved {
                    // First Moved event of this drag — mark as started.
                    // start_x/start_y were already set by reset_drag() to the
                    // pre-drag position, so we don't overwrite them here.
                    // (Previously we overwrote with the current position, which
                    // was already moved, causing wrong direction detection.)
                    t.start_t = now;
                    t.moved = true;
                }

                t.end_x = pos.x;
                t.end_y = pos.y;
                t.last_t = now;
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_pets,
            get_pet,
            get_active_pet,
            set_active_pet,
            set_openrouter_key,
            install_pet,
            uninstall_pet,
            list_installed_pets,
            get_drag_result,
            reset_drag,
            eval_js,
            read_cmd_file,
            write_cmd_result,
            read_file_as_base64,
            read_runtime_state,
            read_runtime_bubble,
            quit_app,
            spawn_sidecar,
            get_sidecar_port,
            stop_sidecar,
            // Win32 click-through toggle (plan §4.4). Windows-only command;
            // cfg'd out on other targets where transparency.rs is absent.
            #[cfg(windows)]
            transparency::set_click_through,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
