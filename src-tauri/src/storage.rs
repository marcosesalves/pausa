//! Local persistence for user settings, via tauri-plugin-store (a JSON file in the app data folder).
//!
//! Everything stays on the user's Mac. The file carries a schema version so future
//! changes can migrate old data; missing fields fall back to their defaults.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::state::{HistoryEntry, Progress, Settings};

const FILE: &str = "settings.json";
const KEY_PROGRESS: &str = "progress";
const KEY_SETTINGS: &str = "settings";
const KEY_VERSION: &str = "version";
const KEY_WINDOW: &str = "window";
const KEY_HISTORY: &str = "history";
const SCHEMA_VERSION: u32 = 1;

/// Load saved settings, or defaults when nothing valid is saved yet.
pub fn load_settings(app: &AppHandle) -> Settings {
    let Ok(store) = app.store(FILE) else {
        return Settings::default();
    };
    store
        .get(KEY_SETTINGS)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

/// Random per-install id (UUID v4 format). It lets reports from one tester be grouped
/// without identifying the person. Created on first use and kept in the store.
pub fn install_id(app: &AppHandle) -> Option<String> {
    let store = app.store(FILE).ok()?;
    if let Some(id) = store.get("install_id").and_then(|v| v.as_str().map(String::from)) {
        return Some(id);
    }
    let mut b: [u8; 16] = rand::random();
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let id = format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]);
    store.set("install_id", json!(id));
    let _ = store.save();
    Some(id)
}

/// Where the window was last (physical pixels), so it reopens in the same place and size.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn load_window_geometry(app: &AppHandle) -> Option<WindowGeometry> {
    let store = app.store(FILE).ok()?;
    store
        .get(KEY_WINDOW)
        .and_then(|value| serde_json::from_value(value).ok())
}

pub fn save_window_geometry(app: &AppHandle, geometry: &WindowGeometry) {
    let Ok(store) = app.store(FILE) else { return };
    if let Ok(value) = serde_json::to_value(geometry) {
        store.set(KEY_WINDOW, value);
        if let Err(err) = store.save() {
            crate::logger::log(&format!("could not save window position: {err}"));
        }
    }
}

/// The recent tips and Breathe sessions, with what became of each. Stays on this computer.
pub fn load_history(app: &AppHandle) -> Vec<HistoryEntry> {
    let Ok(store) = app.store(FILE) else { return Vec::new() };
    store
        .get(KEY_HISTORY)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub fn save_history(app: &AppHandle, history: &[HistoryEntry]) {
    let Ok(store) = app.store(FILE) else {
        crate::logger::log("could not open the store for history");
        return;
    };
    if let Ok(value) = serde_json::to_value(history) {
        store.set(KEY_HISTORY, value);
        if let Err(err) = store.save() {
            crate::logger::log(&format!("could not save history: {err}"));
        }
    }
}

pub fn load_progress(app: &AppHandle) -> Progress {
    let Ok(store) = app.store(FILE) else {
        return Progress::default();
    };
    store
        .get(KEY_PROGRESS)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub fn save_progress(app: &AppHandle, progress: &Progress) {
    let Ok(store) = app.store(FILE) else {
        crate::logger::log("could not open the store for progress");
        return;
    };
    if let Ok(value) = serde_json::to_value(progress) {
        store.set(KEY_PROGRESS, value);
        if let Err(err) = store.save() {
            crate::logger::log(&format!("could not save progress: {err}"));
        }
    }
}

/// Write settings to disk. Failures are logged, never fatal: the app keeps working in memory.
pub fn save_settings(app: &AppHandle, settings: &Settings) {
    let Ok(store) = app.store(FILE) else {
        crate::logger::log("could not open the settings store");
        return;
    };
    match serde_json::to_value(settings) {
        Ok(value) => {
            store.set(KEY_VERSION, json!(SCHEMA_VERSION));
            store.set(KEY_SETTINGS, value);
            if let Err(err) = store.save() {
                crate::logger::log(&format!("could not save settings: {err}"));
            }
        }
        Err(err) => crate::logger::log(&format!("could not serialize settings: {err}")),
    }
}
