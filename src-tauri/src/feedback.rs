//! Bug reports and feedback for the closed test group.
//!
//! Reports go to the `submit-feedback` Supabase edge function. Only the endpoint address is baked in at
//! build time (PAUSA_FEEDBACK_URL). It is not a secret: the installer is public, so the app carries no
//! key or access code at all. The function protects itself with limits on the server, and the service
//! role key stays there.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::logger;
use crate::state::{AppState, Settings};
use crate::storage;

const FEEDBACK_URL: Option<&str> = option_env!("PAUSA_FEEDBACK_URL");
const MAX_SCREENSHOT_BASE64: usize = 2_800_000; // about 2 MB of image

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackContext {
    /// False when this build was made without an endpoint, so sending is impossible.
    configured: bool,
    app_version: String,
    os_version: String,
    settings: Value,
    log_tail: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackInput {
    kind: String,
    message: String,
    contact: Option<String>,
    include_version: bool,
    include_settings: bool,
    include_log: bool,
    screenshot_base64: Option<String>,
}

/// The system version for a report: "26.0" on macOS (as before), "Windows 11 (build 22631.4602) · x86_64" on Windows.
#[cfg(not(windows))]
fn os_version() -> String {
    std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

#[cfg(windows)]
fn os_version() -> String {
    use std::os::windows::process::CommandExt;
    // `cmd /C ver` prints "Microsoft Windows [Version 10.0.22631.4602]". CREATE_NO_WINDOW keeps a console from flashing.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = std::process::Command::new("cmd")
        .args(["/C", "ver"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default();
    // "10.0.22631.4602": the third number is the build, and builds from 22000 on are Windows 11
    let version = output
        .split("Version ")
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .map(str::trim)
        .unwrap_or("");
    let build = version.split('.').nth(2).and_then(|b| b.parse::<u32>().ok());
    let name = match build {
        Some(b) if b >= 22000 => "Windows 11",
        Some(_) => "Windows 10",
        None => "Windows",
    };
    let detail = version.splitn(3, '.').nth(2).unwrap_or("");
    let arch = std::env::consts::ARCH;
    if detail.is_empty() {
        format!("{name} · {arch}")
    } else {
        format!("{name} (build {detail}) · {arch}")
    }
}

/// Settings useful for reproducing a bug. The companion name is left out on purpose.
fn settings_snapshot(s: &Settings) -> Value {
    json!({
        "interval_minutes": s.interval_minutes,
        "selected_categories": s.selected_categories,
        "quiet_hours_enabled": s.quiet_hours_enabled,
        "quiet_hours_start": s.quiet_hours_start,
        "quiet_hours_end": s.quiet_hours_end,
        "paused": s.paused,
        "launch_at_login": s.launch_at_login,
        "close_behavior": s.close_behavior,
        "show_companion": s.show_companion,
        "theme": s.theme,
        "water_reminder": s.water_reminder,
        "posture_reminder": s.posture_reminder,
        "breathe_around": s.breathe_around,
    })
}

fn endpoint() -> Option<String> {
    match FEEDBACK_URL {
        Some(url) if !url.is_empty() => Some(format!(
            "{}/functions/v1/submit-feedback",
            url.trim_end_matches('/')
        )),
        _ => None,
    }
}

/// What a report would contain, so the form can show it before anything is sent.
#[tauri::command]
pub fn get_feedback_context(app: AppHandle) -> FeedbackContext {
    let settings = app.state::<AppState>().get_settings();
    FeedbackContext {
        configured: endpoint().is_some(),
        app_version: app.package_info().version.to_string(),
        os_version: os_version(),
        settings: settings_snapshot(&settings),
        log_tail: logger::tail(80),
    }
}

#[tauri::command]
pub async fn submit_feedback(app: AppHandle, input: FeedbackInput) -> Result<(), String> {
    let Some(url) = endpoint() else {
        return Err("This build can't send feedback because it has no feedback address.".into());
    };
    if input.kind != "bug" && input.kind != "feedback" {
        return Err("Unknown report type.".into());
    }
    let message = input.message.trim();
    if message.is_empty() {
        return Err("Please write a message first.".into());
    }
    if let Some(shot) = &input.screenshot_base64 {
        if shot.len() > MAX_SCREENSHOT_BASE64 {
            return Err("The screenshot is larger than 2 MB.".into());
        }
    }

    let settings = app.state::<AppState>().get_settings();
    let mut payload = json!({
        "kind": input.kind,
        "message": message,
        "contact": input.contact.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        "install_id": storage::install_id(&app),
    });
    // Only what the tester left ticked is sent.
    if input.include_version {
        payload["app_version"] = json!(app.package_info().version.to_string());
        payload["os_version"] = json!(os_version());
    }
    if input.include_settings {
        payload["settings"] = settings_snapshot(&settings);
    }
    if input.include_log {
        payload["log_tail"] = json!(logger::tail(80));
    }
    if let Some(shot) = input.screenshot_base64 {
        payload["screenshot_base64"] = json!(shot);
    }

    let response = reqwest::Client::new()
        .post(url)
        .timeout(Duration::from_secs(25))
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            logger::log(&format!("feedback send failed: {}", e.without_url()));
            "Couldn't reach the feedback server. Check your connection and try again.".to_string()
        })?;

    let status = response.status();
    logger::log(&format!("feedback sent, status {}", status.as_u16()));
    match status.as_u16() {
        200..=299 => Ok(()),
        413 => Err("The screenshot is too large.".into()),
        429 => Err("Too many reports in a short time. Please try again later.".into()),
        503 => Err("Feedback is switched off for now. Please try again later.".into()),
        _ => Err("The feedback server had a problem. Please try again later.".into()),
    }
}
