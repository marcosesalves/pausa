//! Menu bar glyphs and the "Pip wakes up" animation.
//!
//! All frames are monochrome template images (black on transparent, see icons/tray/*.svg).
//! macOS tints them for light, dark and highlighted menu bars.
//!
//! State model:
//!   * resting glyph = Paused (paused or quiet hours) > NewTip (unseen tip) > Default
//!   * a reminder plays a short blink sequence, then rests on NewTip (or Default if the popover is open)
//!   * opening the popover clears the dot; pausing cancels any running animation

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{image::Image, AppHandle, Manager};

use crate::state::AppState;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TrayGlyph {
    Default,
    Paused,
    NewTip,
    Awake,
    Blink,
    AwakeNew,
}

impl TrayGlyph {
    fn code(self) -> u8 {
        self as u8
    }

    /// The @2x frame: macOS scales it down to menu bar height and keeps it crisp.
    fn png(self) -> &'static [u8] {
        match self {
            TrayGlyph::Default => include_bytes!("../icons/tray/sprout@2x.png"),
            TrayGlyph::Paused => include_bytes!("../icons/tray/sprout-paused@2x.png"),
            TrayGlyph::NewTip => include_bytes!("../icons/tray/sprout-new@2x.png"),
            TrayGlyph::Awake => include_bytes!("../icons/tray/sprout-awake@2x.png"),
            TrayGlyph::Blink => include_bytes!("../icons/tray/sprout-blink@2x.png"),
            TrayGlyph::AwakeNew => include_bytes!("../icons/tray/sprout-awake-new@2x.png"),
        }
    }
}

/// Decode an 8-bit RGBA PNG into a tray image.
/// (Uses the `png` crate directly; tauri's `image-png` feature would need an extra download.)
fn decode_png(bytes: &[u8]) -> Option<Image<'static>> {
    let mut reader = png::Decoder::new(bytes).read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).ok()?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    buf.truncate(info.buffer_size());
    Some(Image::new_owned(buf, info.width, info.height))
}

/// True while the Windows taskbar is dark, so the glyph must be drawn in white. Always false elsewhere:
/// macOS tints template images itself. It follows the SYSTEM theme (the taskbar's), not the app's.
static DARK_TASKBAR: AtomicBool = AtomicBool::new(false);

fn dark_taskbar() -> bool {
    DARK_TASKBAR.load(Ordering::SeqCst)
}

/// Read the taskbar theme (HKCU ...\Themes\Personalize, SystemUsesLightTheme: 0 is dark, 1 is light).
#[cfg(windows)]
fn refresh_theme() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000; // no console flash
    let output = std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "/v",
            "SystemUsesLightTheme",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default();
    // The value reads "0x0" (dark) or "0x1" (light). If it can't be read, keep the last answer.
    if let Some(value) = output.split_whitespace().last() {
        match value {
            "0x0" => DARK_TASKBAR.store(true, Ordering::SeqCst),
            "0x1" => DARK_TASKBAR.store(false, Ordering::SeqCst),
            _ => {}
        }
    }
}

#[cfg(not(windows))]
fn refresh_theme() {}

/// The same glyph drawn in white (keeping its shape, which lives in the alpha channel).
#[cfg(windows)]
fn white_ink(icon: Image<'static>) -> Image<'static> {
    let mut rgba = icon.rgba().to_vec();
    for px in rgba.chunks_exact_mut(4) {
        px[0] = 255;
        px[1] = 255;
        px[2] = 255;
    }
    Image::new_owned(rgba, icon.width(), icon.height())
}

/// Put one glyph on the status item. Skips the call when it is already showing.
pub fn set_glyph(app: &AppHandle, glyph: TrayGlyph) {
    let state = app.state::<AppState>();
    // The code also says which ink the icon is in, so a change of system theme repaints it
    let code = glyph.code() | if dark_taskbar() { 0x80 } else { 0 };
    if state.last_glyph.swap(code, Ordering::SeqCst) == code {
        return;
    }
    if let (Some(tray), Some(icon)) = (app.tray_by_id("main"), decode_png(glyph.png())) {
        #[cfg(windows)]
        let icon = if dark_taskbar() { white_ink(icon) } else { icon };
        let _ = tray.set_icon(Some(icon));
        // set_icon resets the template flag, so it must be set again every time
        let _ = tray.set_icon_as_template(true);
    }
}

/// macOS "Reduce motion" (System Settings, Accessibility, Display).
#[cfg(target_os = "macos")]
fn reduce_motion() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
}

/// Windows "Animation effects" (Settings, Accessibility, Visual effects). Off means reduce motion.
#[cfg(windows)]
fn reduce_motion() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn SystemParametersInfoW(
            ui_action: u32,
            ui_param: u32,
            pv_param: *mut core::ffi::c_void,
            f_win_ini: u32,
        ) -> i32;
    }
    const SPI_GETCLIENTAREAANIMATION: u32 = 0x1042;
    let mut animations_on: i32 = 1; // a Windows BOOL
    // SAFETY: the pointer is to a live i32, which is what this query writes into
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            &mut animations_on as *mut i32 as *mut core::ffi::c_void,
            0,
        )
    };
    ok != 0 && animations_on == 0
}

#[cfg(not(any(target_os = "macos", windows)))]
fn reduce_motion() -> bool {
    false
}

/// Draw a 16 x 16 badge from a function of the offset from its centre (None is transparent).
#[cfg(windows)]
fn badge_image(paint: impl Fn(f32, f32) -> Option<[u8; 4]>) -> Image<'static> {
    const N: u32 = 16;
    let mut rgba = Vec::with_capacity((N * N * 4) as usize);
    for y in 0..N {
        for x in 0..N {
            let px = paint(x as f32 + 0.5 - 8.0, y as f32 + 0.5 - 8.0).unwrap_or([0, 0, 0, 0]);
            rgba.extend_from_slice(&px);
        }
    }
    Image::new_owned(rgba, N, N)
}

/// The "new tip waiting" badge on the taskbar button: an accent dot with a light ring.
#[cfg(windows)]
fn badge_dot() -> Image<'static> {
    badge_image(|dx, dy| {
        let d = (dx * dx + dy * dy).sqrt();
        if d <= 5.5 {
            Some([0x2d, 0x5a, 0x3d, 255])
        } else if d <= 7.3 {
            Some([255, 255, 255, 235])
        } else {
            None
        }
    })
}

/// The "paused" badge: a light disc with two dark bars.
#[cfg(windows)]
fn badge_pause() -> Image<'static> {
    badge_image(|dx, dy| {
        if (dx * dx + dy * dy).sqrt() > 7.3 {
            None
        } else if dy.abs() <= 3.5 && ((dx + 2.2).abs() <= 1.0 || (dx - 2.2).abs() <= 1.0) {
            Some([0x1e, 0x33, 0x26, 255])
        } else {
            Some([251, 249, 242, 255])
        }
    })
}

/// Windows: show the state on the taskbar button too (paused, or a tip waiting), because the tray icon
/// may be hidden under the ^ arrow. Elsewhere there is nothing to do.
#[cfg(windows)]
fn update_taskbar_badge(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let state = app.state::<AppState>();
    let badge = if state.get_settings().paused {
        Some(badge_pause())
    } else if state.new_tip_pending.load(Ordering::SeqCst) {
        Some(badge_dot())
    } else {
        None
    };
    let _ = window.set_overlay_icon(badge);
}

#[cfg(not(windows))]
fn update_taskbar_badge(_app: &AppHandle) {}

/// Windows: flash the taskbar button once when a tip arrives and the window is not in front.
#[cfg(windows)]
fn flash_taskbar(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
}

#[cfg(not(windows))]
fn flash_taskbar(_app: &AppHandle) {}

/// Paused, or inside quiet hours right now.
fn resting(app: &AppHandle) -> bool {
    let s = app.state::<AppState>().get_settings();
    s.paused
        || (s.quiet_hours_enabled
            && crate::scheduler::is_quiet_hours(&s.quiet_hours_start, &s.quiet_hours_end))
}

/// The glyph to rest on when nothing is animating.
fn rest_glyph(app: &AppHandle) -> TrayGlyph {
    if resting(app) {
        TrayGlyph::Paused
    } else if app.state::<AppState>().new_tip_pending.load(Ordering::SeqCst) {
        TrayGlyph::NewTip
    } else {
        TrayGlyph::Default
    }
}

/// Bring the icon in line with the current state.
/// `cancel` also stops a running wake sequence (use it when the state changed on purpose).
pub fn refresh(app: &AppHandle, cancel: bool) {
    let state = app.state::<AppState>();
    if cancel {
        state.wake_generation.fetch_add(1, Ordering::SeqCst);
        state.wake_active.store(false, Ordering::SeqCst);
    } else if state.wake_active.load(Ordering::SeqCst) {
        return; // let the animation finish
    }
    set_glyph(app, rest_glyph(app));
    update_taskbar_badge(app);
}

/// Re-check twice a minute so the icon flips when quiet hours begin or end, or the system theme changes.
/// Also sets it at start.
pub async fn watch(app: AppHandle) {
    loop {
        refresh_theme();
        // The Mac's click settings can change at any time (System Settings, Trackpad), so look again
        #[cfg(target_os = "macos")]
        {
            let handle = app.clone();
            let _ = tokio::task::spawn_blocking(move || crate::tray::refresh_click_behavior(&handle)).await;
        }
        refresh(&app, false);
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

/// The popover (or the feedback form) was opened: the tip has been seen.
pub fn popover_opened(app: &AppHandle) {
    app.state::<AppState>().new_tip_pending.store(false, Ordering::SeqCst);
    refresh(app, true);
}

/// Pause toggled on purpose: show the matching glyph at once and forget any unseen tip.
pub fn pause_toggled(app: &AppHandle) {
    app.state::<AppState>().new_tip_pending.store(false, Ordering::SeqCst);
    refresh(app, true);
}

/// A reminder fired. Call this BEFORE the focus overlay opens, so "is the popover open" is still accurate.
pub fn reminder_arrived(app: &AppHandle) {
    let state = app.state::<AppState>();

    // Paused: no animation, just make sure the paused glyph shows
    if state.get_settings().paused {
        refresh(app, true);
        return;
    }

    let popover_open = app
        .get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false);
    state.new_tip_pending.store(!popover_open, Ordering::SeqCst);
    update_taskbar_badge(app);
    if !popover_open {
        flash_taskbar(app);
    }
    let end = if popover_open { TrayGlyph::Default } else { TrayGlyph::NewTip };

    // Cancels any earlier sequence: its steps see a newer generation and stop
    let generation = state.wake_generation.fetch_add(1, Ordering::SeqCst) + 1;

    if reduce_motion() {
        state.wake_active.store(false, Ordering::SeqCst);
        set_glyph(app, end);
        return;
    }

    state.wake_active.store(true, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        play_wake(&app, generation, end).await;
    });
}

/// The wake sequence (milliseconds from the start). Runs on its own task, never the main thread.
const STEPS: [(u64, TrayGlyph); 6] = [
    (0, TrayGlyph::Awake),
    (1200, TrayGlyph::Blink),
    (1350, TrayGlyph::Awake),
    (2400, TrayGlyph::Blink),
    (2550, TrayGlyph::Awake),
    (2600, TrayGlyph::AwakeNew),
];
const REST_AT_MS: u64 = 3600;

async fn play_wake(app: &AppHandle, generation: u64, end: TrayGlyph) {
    let state = app.state::<AppState>();
    let current = || state.wake_generation.load(Ordering::SeqCst) == generation;

    let mut elapsed = 0;
    for (at, glyph) in STEPS.iter().copied().chain([(REST_AT_MS, end)]) {
        tokio::time::sleep(Duration::from_millis(at - elapsed)).await;
        elapsed = at;
        if !current() {
            return; // a newer reminder, the popover, or a pause took over
        }
        set_glyph(app, glyph);
    }
    state.wake_active.store(false, Ordering::SeqCst);
    // The resting state may have changed mid-sequence (for example quiet hours began)
    refresh(app, false);
}
