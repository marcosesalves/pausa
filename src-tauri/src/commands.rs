use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;

use crate::focus::{self, FocusPayload, PendingFocus};
use crate::state::{AppState, BreatheAround, HistoryEntry, Progress, Settings};
use crate::tips::{self, Tip};

/// Register or remove Pausa as a login item (a LaunchAgent on macOS). Only does something when the
/// real state differs, and a failure is logged, never fatal.
pub fn apply_launch_at_login(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    let current = manager.is_enabled().unwrap_or(false);
    if current == enabled {
        return;
    }
    let result = if enabled { manager.enable() } else { manager.disable() };
    match result {
        Ok(()) => crate::logger::log(&format!("launch at login {}", if enabled { "on" } else { "off" })),
        Err(err) => crate::logger::log(&format!("launch at login change failed: {err}")),
    }
}

/// Make the native parts of every window (the title bar on a Mac, the blur behind the focus card) follow
/// the chosen theme. "system" gives control back to the computer's own light or dark mode.
pub fn apply_theme(app: &AppHandle, theme: &str) {
    let native = match theme {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    };
    for window in app.webview_windows().values() {
        let _ = window.set_theme(native);
    }
}

/// "Add a breath: Before / After" in the tip card: remember the choice for that category and tell every
/// window. A category with neither chosen is simply removed, so the saved list only holds real choices.
#[tauri::command]
pub fn set_breathe_around(app: AppHandle, category: String, before: bool, after: bool) {
    let state = app.state::<AppState>();
    let mut settings = state.get_settings();
    if before || after {
        settings.breathe_around.insert(category, BreatheAround { before, after });
    } else {
        settings.breathe_around.remove(&category);
    }
    crate::storage::save_settings(&app, &settings);
    state.update_settings(settings.clone());
    let _ = app.emit("settings-changed", settings);
}

/// How the Mac is set to click, so Settings can explain what Pausa adjusted.
#[tauri::command]
pub fn get_click_settings() -> crate::click_settings::ClickSettings {
    crate::tray::click_settings_now()
}

/// Show a water or posture reminder: the same card as a tip, without touching Home's tip, History or
/// the pause count.
pub fn show_reminder(app: &AppHandle, tip: &Tip) {
    crate::tray_icon::reminder_arrived(app);
    crate::logger::log(&format!("reminder shown, kind {}", tip.category));
    if !focus::show(app, tip) {
        let _ = app.notification().builder().title("Pausa").body(&tip.text).show();
    }
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    let state = app.state::<AppState>();
    state.get_settings()
}

#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Settings) {
    let state = app.state::<AppState>();
    let previous = state.get_settings();
    if previous.launch_at_login != settings.launch_at_login {
        apply_launch_at_login(&app, settings.launch_at_login);
    }
    // A changed schedule starts that wait afresh, and only that one
    if previous.interval_minutes != settings.interval_minutes {
        state.reschedule.notify_waiters();
    }
    if previous.water_reminder != settings.water_reminder
        || previous.water_interval_minutes != settings.water_interval_minutes
    {
        state.reschedule_water.notify_waiters();
    }
    if previous.posture_reminder != settings.posture_reminder
        || previous.posture_interval_minutes != settings.posture_interval_minutes
    {
        state.reschedule_posture.notify_waiters();
    }
    if previous.theme != settings.theme {
        apply_theme(&app, &settings.theme);
    }
    let paused_changed = previous.paused != settings.paused;
    crate::storage::save_settings(&app, &settings);
    state.update_settings(settings);
    if paused_changed {
        crate::tray_icon::pause_toggled(&app);
    } else {
        crate::tray_icon::refresh(&app, false); // quiet hours may have been edited
    }
}

#[tauri::command]
pub fn get_next_tip(app: AppHandle) -> Option<Tip> {
    let all_tips = tips::load_tips();
    let state = app.state::<AppState>();
    let settings = state.get_settings();
    let recent_ids = state.get_recent_tip_ids();

    let affinity = state.get_progress().affinity;
    let tip = tips::select_tip(&all_tips, &settings.effective_categories(), &recent_ids, &affinity);
    if let Some(ref t) = tip {
        persist_history(&app, state.record_shown(t.id));
    }
    tip
}

/// Save the history and tell the window it changed, so History is never behind.
pub fn persist_history(app: &AppHandle, history: Vec<HistoryEntry>) {
    crate::storage::save_history(app, &history);
    let _ = app.emit("history-changed", ());
}

/// One line of History as the window shows it: the tip (or a Breathe title), when, and what became of it.
#[derive(Debug, serde::Serialize)]
pub struct HistoryItem {
    tip: Option<Tip>,
    title: Option<String>,
    at: u64,
    outcome: String,
}

/// The last ten things shown, newest first.
#[tauri::command]
pub fn get_history(app: AppHandle) -> Vec<HistoryItem> {
    let all_tips = tips::load_tips();
    app.state::<AppState>()
        .get_history()
        .into_iter()
        .rev()
        .filter_map(|e| {
            if e.tip_id == 0 {
                return Some(HistoryItem { tip: None, title: e.title, at: e.at, outcome: e.outcome });
            }
            // A tip that is no longer in the bundled list is left out rather than shown blank
            let tip = all_tips.iter().find(|t| t.id == e.tip_id)?.clone();
            Some(HistoryItem { tip: Some(tip), title: None, at: e.at, outcome: e.outcome })
        })
        .take(10)
        .collect()
}

/// When the next reminder is due, in seconds since the Unix epoch (0 until the scheduler has started).
#[tauri::command]
pub fn get_next_nudge(app: AppHandle) -> u64 {
    app.state::<AppState>().next_nudge_at.load(std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
pub fn trigger_reminder_now(app: AppHandle) -> Option<Tip> {
    let tip = get_next_tip(app.clone());
    if let Some(ref t) = tip {
        notify(&app, t);
    }
    tip
}

/// Show the focus overlay; fall back to a native notification if it can't open.
pub fn notify(app: &AppHandle, tip: &Tip) {
    // First, while we can still tell whether the window was open: animate the tray icon
    crate::tray_icon::reminder_arrived(app);
    crate::logger::log(&format!("reminder shown, category {}", tip.category));
    if !focus::show(app, tip) {
        crate::logger::log("focus overlay unavailable, used a system notification");
        let _ = app
            .notification()
            .builder()
            .title("Pausa")
            .body(&tip.text)
            .show();
    }
    let _ = app.emit("reminder-tick", tip);
}

/// The first-close dialog's "Keep running": hide the window to the tray. With `dont_show_again`
/// the explanation is never shown again, and the choice is stored as "tray".
#[tauri::command]
pub fn close_to_tray(app: AppHandle, dont_show_again: bool) {
    if dont_show_again {
        let state = app.state::<AppState>();
        let mut settings = state.get_settings();
        settings.close_notice_seen = true;
        settings.close_behavior = "tray".into();
        crate::storage::save_settings(&app, &settings);
        state.update_settings(settings);
    }
    crate::tray::hide_window(&app);
}

/// Quit Pausa for real (the first-close dialog's "Quit Pausa", and Settings).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    crate::tray::quit(&app);
}

/// "Take a moment" in the window: show this tip in the focus overlay and get the window out of the way.
#[tauri::command]
pub fn show_focus_for(app: AppHandle, tip: Tip) {
    crate::tray::hide_window(&app);
    focus::show(&app, &tip);
}

/// A tip was dismissed (Later, Esc, timeout) without being done. Saved quietly, no event.
#[tauri::command]
pub fn record_skip(app: AppHandle, category: String, tip_id: Option<u32>) {
    // Water and posture reminders are not pauses: dismissing one says nothing about the user's taste in tips
    if crate::reminders::is_reminder_category(&category) {
        return;
    }
    let state = app.state::<AppState>();
    let progress = state.record_skip(&category);
    crate::storage::save_progress(&app, &progress);
    if let Some(id) = tip_id {
        persist_history(&app, state.mark_outcome(id, "skipped"));
    }
}

#[tauri::command]
pub fn get_progress(app: AppHandle) -> Progress {
    app.state::<AppState>().get_progress()
}

/// Called when a pause or exercise is completed. Notifies every window.
#[tauri::command]
pub fn record_pause(
    app: AppHandle,
    category: Option<String>,
    tip_id: Option<u32>,
    title: Option<String>,
) -> Progress {
    let state = app.state::<AppState>();
    let progress = state.record_pause(category.as_deref());
    crate::storage::save_progress(&app, &progress);
    // The same pause goes into History, so History and the pause count agree. A tip's pause marks
    // that tip done; a Breathe session (no tip) is added under its title.
    if let Some(id) = tip_id {
        persist_history(&app, state.mark_outcome(id, "done"));
    } else if let Some(title) = title {
        persist_history(&app, state.record_breathe(&title));
    }
    let _ = app.emit("progress-changed", &progress);
    progress
}

#[tauri::command]
pub fn get_pending_focus(app: AppHandle) -> Option<FocusPayload> {
    app.state::<PendingFocus>().0.lock().unwrap().clone()
}

#[tauri::command]
pub fn dismiss_focus(app: AppHandle) {
    focus::hide(&app);
}
