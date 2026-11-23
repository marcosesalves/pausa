mod click_settings;
mod commands;
mod feedback;
mod focus;
mod logger;
mod reminders;
mod scheduler;
mod state;
mod storage;
mod tips;
mod tray;
mod tray_icon;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState::new())
        .manage(focus::PendingFocus::default())
        .setup(|app| {
            logger::init(app.handle());
            logger::log(&format!("Pausa {} started", app.package_info().version));

            // Restore the settings saved last time
            let saved = storage::load_settings(app.handle());
            let first_run = !saved.onboarded;
            // Keep the login item in step with the saved choice (it can drift if the app was moved or reinstalled)
            commands::apply_launch_at_login(app.handle(), saved.launch_at_login);
            let theme = saved.theme.clone();
            app.state::<AppState>().update_settings(saved);
            app.state::<AppState>()
                .set_progress(storage::load_progress(app.handle()));
            // History survives a restart, so it and the pause count tell the same story
            app.state::<AppState>()
                .set_history(storage::load_history(app.handle()));

            // Windows draws its own title bar in the page (TitleBar.tsx), so the native one goes. The window
            // is still hidden here, so nothing flashes. macOS keeps its native bar.
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(true); // keeps the shadow and the rounded corners of Windows 11
            }

            // Hidden full-screen overlay used for focus notifications
            focus::create(app.handle())?;
            // Light, dark or system, for the native parts of both windows (the web parts follow in the page)
            commands::apply_theme(app.handle(), &theme);

            // Set up tray icon and menu
            tray::create_tray(app.handle())?;
            // Keeps the tray glyph in step with paused / quiet hours (also sets it now)
            tauri::async_runtime::spawn(tray_icon::watch(app.handle().clone()));

            // First launch: open the window by itself so the welcome is seen. Later launches (for
            // example at login) stay in the tray until the user opens Pausa.
            if first_run {
                tray::show_window(app.handle());
            }

            // Spawn the background reminder scheduler, and the water and posture reminders
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(scheduler::run(handle));
            tauri::async_runtime::spawn(scheduler::run_reminder(app.handle().clone(), reminders::Kind::Water));
            tauri::async_runtime::spawn(scheduler::run_reminder(app.handle().clone(), reminders::Kind::Posture));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::get_next_tip,
            commands::get_next_nudge,
            commands::get_history,
            commands::get_click_settings,
            commands::set_breathe_around,
            commands::trigger_reminder_now,
            feedback::get_feedback_context,
            feedback::submit_feedback,
            commands::close_to_tray,
            commands::quit_app,
            commands::show_focus_for,
            commands::get_progress,
            commands::record_pause,
            commands::record_skip,
            commands::get_pending_focus,
            commands::dismiss_focus,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // Clicking the Dock icon opens the window (macOS only)
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => tray::show_window(app),
                // Cmd+Q or a system shutdown: remember where the window was
                tauri::RunEvent::ExitRequested { .. } => tray::save_geometry(app),
                _ => {}
            }
        });
}
