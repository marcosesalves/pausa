//! Focus notification: a full-screen, transparent overlay window.
//!
//! The window uses native macOS vibrancy (NSVisualEffectView), which blurs
//! everything behind it, including other apps. CSS `backdrop-filter` cannot do
//! that, so the web layer only draws the tint and the card on top.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

use crate::tips::Tip;

pub const LABEL: &str = "focus";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusPayload {
    pub tip: Tip,
    /// Height (logical px) of the area at the bottom taken by the Dock.
    pub dock_inset: f64,
}

/// The last payload, so a freshly loaded overlay can ask for it.
#[derive(Default)]
pub struct PendingFocus(pub Mutex<Option<FocusPayload>>);

/// Create the overlay hidden at startup so showing it later is instant.
pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let builder = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?window=focus".into()),
    )
    .title("Pausa focus")
    .visible(false)
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .shadow(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .focused(false)
    .inner_size(800.0, 600.0);

    // The native blur exists on macOS only (Effect::Popover). Asking for it elsewhere can make the
    // window fail to build, which would stop the whole app starting. On Windows the overlay is a plain
    // tint over the work area, as designed: no blur, no Acrylic or Mica.
    #[cfg(target_os = "macos")]
    let builder = builder.effects(
        tauri::window::EffectsBuilder::new()
            .effect(tauri::window::Effect::Popover)
            .state(tauri::window::EffectState::Active)
            .build(),
    );

    let window = builder.build()?;
    Ok(window)
}

/// Windows: cover the primary monitor's work area, not the whole screen. The taskbar stays undimmed
/// and reachable, and wherever it sits (any edge) the card centres in what is left, so no Dock-style
/// inset is needed and 0 is reported.
#[cfg(windows)]
fn fit_to_screen(app: &AppHandle, window: &WebviewWindow) -> f64 {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        let _ = window.set_size(LogicalSize::new(1440.0, 900.0));
        return 0.0;
    };
    let work = monitor.work_area();
    let _ = window.set_size(PhysicalSize::new(work.size.width, work.size.height));
    let _ = window.set_position(PhysicalPosition::new(work.position.x, work.position.y));
    0.0
}

/// macOS: cover the whole primary monitor and report how tall the Dock area is.
#[cfg(not(windows))]
fn fit_to_screen(app: &AppHandle, window: &WebviewWindow) -> f64 {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        let _ = window.set_size(LogicalSize::new(1440.0, 900.0));
        return 0.0;
    };
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let pos = monitor.position();
    let _ = window.set_size(PhysicalSize::new(size.width, size.height));
    let _ = window.set_position(PhysicalPosition::new(pos.x, pos.y));

    // work_area excludes the menu bar and a visible Dock.
    let work = monitor.work_area();
    let work_bottom = work.position.y as f64 + work.size.height as f64;
    let screen_bottom = pos.y as f64 + size.height as f64;
    ((screen_bottom - work_bottom) / scale).max(0.0)
}

pub fn show(app: &AppHandle, tip: &Tip) -> bool {
    let Some(window) = app.get_webview_window(LABEL) else {
        return false;
    };
    let payload = FocusPayload {
        tip: tip.clone(),
        dock_inset: fit_to_screen(app, &window),
    };
    *app.state::<PendingFocus>().0.lock().unwrap() = Some(payload.clone());

    if window.show().is_err() {
        return false;
    }
    // Remember when, so a second reminder waits instead of landing on top of this one
    app.state::<crate::state::AppState>().last_card_at.store(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        std::sync::atomic::Ordering::SeqCst,
    );
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus(); // so Esc reaches the card
    let _ = app.emit_to(LABEL, "focus-show", payload);
    true
}

pub fn hide(app: &AppHandle) {
    *app.state::<PendingFocus>().0.lock().unwrap() = None;
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}
