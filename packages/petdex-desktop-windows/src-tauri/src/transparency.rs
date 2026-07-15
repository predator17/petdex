//! Win32 transparency + click-through for the pet overlay (plan §4.4).
//!
//! Two behaviors are needed for a floating desktop pet on Windows:
//!
//! 1. **Per-pixel alpha transparency** so anti-aliased sprite edges blend
//!    cleanly against whatever is behind the window (no color-key fringe).
//! 2. **Click-through** so transparent regions of the window pass pointer
//!    events to the desktop/windows below, while the sprite body and any
//!    HTML controls (drag handle, right-click menu) stay interactive.
//!
//! ## Why not UpdateLayeredWindow?
//!
//! The plan suggested `UpdateLayeredWindow` with a 32-bit ARGB DIB. In
//! practice that conflicts with Tauri/WebView2: a transparent Tauri window
//! is created with `WS_EX_NOREDIRECTIONBITMAP` so the WebView2 compositor
//! owns per-pixel alpha directly — adding `WS_EX_LAYERED` (required by
//! `UpdateLayeredWindow`) is mutually exclusive with that and breaks the
//! WebView render (see tauri#13070). Tauri's `transparent: true` already
//! delivers clean per-pixel alpha via the compositor; we therefore do NOT
//! touch `UpdateLayeredWindow`.
//!
//! ## The Faksimile pattern we DO implement
//!
//! [Faksimile/WebView2-Click-Through] proved that the reliable way to get
//! *toggleable* click-through with a WebView2 host is to dynamically flip
//! the `WS_EX_TRANSPARENT` extended style on the whole HWND based on
//! whether the cursor is currently over a clickable HTML element:
//!
//!   - cursor over the sprite / a control  → clear `WS_EX_TRANSPARENT`
//!     (window receives pointer events; drag + right-click work)
//!   - cursor over a transparent region    → set `WS_EX_TRANSPARENT`
//!     (the OS passes clicks through to windows below)
//!
//! The JS bridge (`ui/index.html`) calls `set_click_through(true|false)`
//! on mouseenter/mouseleave of the interactive elements. This module
//! exposes that as the `set_click_through` Tauri command.
//!
//! [Faksimile/WebView2-Click-Through]: https://github.com/Faksimile/WebView2-Click-Through

#![cfg(windows)]

use tauri::Manager;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TRANSPARENT,
};

fn app_hwnd(app: &tauri::AppHandle) -> Result<HWND, String> {
    let main = app
        .get_webview_window("pet")
        .ok_or_else(|| "main webview window 'pet' not found".to_string())?;
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("failed to read HWND: {e}"))?;
    Ok(hwnd)
}

/// Toggle the `WS_EX_TRANSPARENT` extended style on the overlay HWND.
///
/// When set, the window is "transparent to hit-testing" — the OS passes
/// pointer events through to whatever is behind the window. When clear,
/// the window receives pointer events normally (drag handle, context menu,
/// sprite grab all work).
///
/// This is the per-window toggle the JS bridge drives on mouseenter/
/// mouseleave of interactive elements (the Faksimile pattern). Per-pixel
/// click-through (only transparent regions pass through) would require the
/// layered-window approach that conflicts with WebView2; the toggle is the
/// proven reliable substitute.
pub fn apply_click_through(app: &tauri::AppHandle, through: bool) -> Result<(), String> {
    let hwnd = app_hwnd(app)?;
    // Safety: GetWindowLongPtrW/SetWindowLongPtrW on our own HWND is the
    // documented, race-free way to read/modify the extended style. The
    // handle is only ever our window's, and the style field is a plain
    // isize. No aliasing of Rust-owned memory occurs.
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_style = if through {
            style | WS_EX_TRANSPARENT.0 as isize
        } else {
            style & !(WS_EX_TRANSPARENT.0 as isize)
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
    }
    Ok(())
}

/// Tauri command wrapper. Invoked from the JS bridge as
/// `invoke("set_click_through", { through: true|false })`.
#[tauri::command]
pub fn set_click_through(app: tauri::AppHandle, through: bool) -> Result<(), String> {
    apply_click_through(&app, through)
}
