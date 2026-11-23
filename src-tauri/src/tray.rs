use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};
use tauri_plugin_opener::OpenerExt;

use crate::click_settings::{self, ClickSettings};
use crate::storage::WindowGeometry;

const MAIN: &str = "main";
/// Keep in sync with src/lib/links.ts and the landing page.
const INSTAGRAM_URL: &str = "https://www.instagram.com/pausa.companion/";

/// Set once the app is really quitting, so the close handler lets the window go.
static QUITTING: AtomicBool = AtomicBool::new(false);

/// What the Mac is set to do on a click (see click_settings.rs). Other systems keep the defaults.
static SECONDARY_CLICK: AtomicBool = AtomicBool::new(true);
static TAP_TO_CLICK: AtomicBool = AtomicBool::new(true);
/// When the icon was last clicked (ms), so one tap that reports twice cannot toggle the window twice.
static LAST_CLICK_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The click settings found by the last refresh.
pub fn click_settings_now() -> ClickSettings {
    ClickSettings {
        secondary_click: SECONDARY_CLICK.load(Ordering::SeqCst),
        tap_to_click: TAP_TO_CLICK.load(Ordering::SeqCst),
    }
}

/// Read the Mac's click settings and adjust the icon to them. With a secondary click available (two
/// fingers, a corner or a two-button mouse), a plain click shows or hides the window and a secondary
/// click opens the menu. With none, the menu would be out of reach, so a plain click opens the menu
/// instead; it begins with "Show Pausa". Runs a few short commands, so call it off the main thread.
pub fn refresh_click_behavior(app: &AppHandle) {
    let found = click_settings::read();
    SECONDARY_CLICK.store(found.secondary_click, Ordering::SeqCst);
    TAP_TO_CLICK.store(found.tap_to_click, Ordering::SeqCst);
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_show_menu_on_left_click(!found.secondary_click);
    }
}

/// Bring the main window to the front: restore it if minimised, show it, give it focus.
/// Every way of opening the window (tray, Dock click, first launch, menu items) goes through here.
pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    // Opening the window means the tip has been seen: clear the dot
    crate::tray_icon::popover_opened(app);
}

/// Hide the window to the tray and remember where it was.
pub fn hide_window(app: &AppHandle) {
    save_geometry(app);
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.hide();
    }
}

/// Quit for real (tray menu, Settings, the close dialog).
pub fn quit(app: &AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    save_geometry(app);
    app.exit(0);
}

/// Remember the window's position and size (physical pixels).
pub fn save_geometry(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN) else { return };
    if window.is_minimized().unwrap_or(false) {
        return; // a minimised window reports a meaningless position on some systems
    }
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else { return };
    crate::storage::save_window_geometry(
        app,
        &WindowGeometry { x: pos.x, y: pos.y, width: size.width, height: size.height },
    );
}

/// Put the window back where it was. If that spot is no longer on any screen (the monitor was
/// unplugged, the resolution changed), centre it instead so it never opens out of reach.
pub fn restore_geometry(app: &AppHandle, window: &WebviewWindow) {
    let Some(saved) = crate::storage::load_window_geometry(app) else {
        let _ = window.center();
        return;
    };
    let _ = window.set_size(PhysicalSize::new(saved.width, saved.height));

    // Require the title area (top-left plus a margin) to sit inside a monitor, so the window can be grabbed
    let probe_x = saved.x as f64 + 48.0;
    let probe_y = saved.y as f64 + 16.0;
    let on_screen = app
        .available_monitors()
        .map(|monitors| {
            monitors.iter().any(|m| {
                let p = m.position();
                let s = m.size();
                probe_x >= p.x as f64
                    && probe_x < p.x as f64 + s.width as f64
                    && probe_y >= p.y as f64
                    && probe_y < p.y as f64 + s.height as f64
            })
        })
        .unwrap_or(false);

    if on_screen {
        let _ = window.set_position(PhysicalPosition::new(saved.x, saved.y));
    } else {
        let _ = window.center();
    }
}

/// Open the window on the feedback form ("bug" or "feedback").
fn open_feedback(app: &AppHandle, kind: &str) {
    show_window(app);
    let _ = app.emit_to(MAIN, "open-feedback", kind);
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_pausa = MenuItem::with_id(app, "show_pausa", "Show Pausa", true, None::<&str>)?;
    let show_tip = MenuItem::with_id(app, "show_tip", "Show Tip Now", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;
    let report_bug = MenuItem::with_id(app, "report_bug", "Report a bug…", true, None::<&str>)?;
    let give_feedback = MenuItem::with_id(app, "give_feedback", "Give feedback…", true, None::<&str>)?;
    let instagram = MenuItem::with_id(app, "instagram", "Follow on Instagram…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator_a = PredefinedMenuItem::separator(app)?;
    let separator_b = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_pausa,
            &show_tip,
            &pause,
            &separator_a,
            &report_bug,
            &give_feedback,
            &instagram,
            &separator_b,
            &quit_item,
        ],
    )?;

    let tray = app.tray_by_id("main").expect("tray not found");
    tray.set_menu(Some(menu))?;
    tray.set_show_menu_on_left_click(false)?;

    let app_handle = app.clone();
    tray.on_tray_icon_event(move |_tray, event| {
        // Only respond to the left button release (not the press, to avoid a double fire)
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            // One tap that reports twice (tap to click can) must not toggle the window twice
            let now = now_ms();
            if now.saturating_sub(LAST_CLICK_MS.swap(now, Ordering::SeqCst)) < 250 {
                return;
            }
            let Some(window) = app_handle.get_webview_window(MAIN) else { return };
            // A click toggles the window. Focus is not part of the test: on Windows the click itself
            // moves the focus to the taskbar, so "is it focused" would always read false there.
            let open = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
            if open {
                hide_window(&app_handle);
            } else {
                show_window(&app_handle);
            }
        }
    });

    // The close button hides the window to the tray instead of quitting. The first time, the page
    // explains it ("Pausa keeps running") and the user picks; later closes follow the saved choice.
    if let Some(window) = app.get_webview_window(MAIN) {
        restore_geometry(app, &window);
        let handle = app.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if QUITTING.load(Ordering::SeqCst) {
                    return; // really quitting: let it close
                }
                api.prevent_close();
                let settings = handle.state::<crate::state::AppState>().get_settings();
                if !settings.close_notice_seen {
                    let _ = handle.emit_to(MAIN, "close-requested", ());
                } else if settings.close_behavior == "quit" {
                    quit(&handle);
                } else {
                    hide_window(&handle);
                }
            }
        });
    }

    let app_handle2 = app.clone();
    tray.on_menu_event(move |_app, event| match event.id.as_ref() {
        "show_pausa" => show_window(&app_handle2),
        "show_tip" => {
            let _ = crate::commands::trigger_reminder_now(app_handle2.clone());
        }
        "pause" => {
            let state = app_handle2.state::<crate::state::AppState>();
            let mut settings = state.get_settings();
            settings.paused = !settings.paused;
            crate::storage::save_settings(&app_handle2, &settings);
            state.update_settings(settings);
            crate::tray_icon::pause_toggled(&app_handle2);
        }
        "report_bug" => open_feedback(&app_handle2, "bug"),
        "give_feedback" => open_feedback(&app_handle2, "feedback"),
        "instagram" => {
            // opens in the default browser
            let _ = app_handle2.opener().open_url(INSTAGRAM_URL, None::<&str>);
        }
        "quit" => quit(&app_handle2),
        _ => {}
    });

    Ok(())
}
