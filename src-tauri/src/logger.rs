//! Tiny file logger. Its last lines can be attached to a bug report (only if the tester agrees).
//!
//! Rule: log events, never content. No tip text, no companion name, no free text from the user.

use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::OnceLock,
};
use tauri::{AppHandle, Manager};

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

const MAX_BYTES: u64 = 256 * 1024; // trim the file once it grows past this...
const KEEP_BYTES: usize = 100 * 1024; // ...keeping only the newest part
const MAX_REPORT_CHARS: usize = 20_000; // matches the limit in the submit-feedback function

pub fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("pausa.log");

    if fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        if let Ok(text) = fs::read_to_string(&path) {
            let mut start = text.len().saturating_sub(KEEP_BYTES);
            while !text.is_char_boundary(start) {
                start += 1;
            }
            let _ = fs::write(&path, &text[start..]);
        }
    }
    let _ = LOG_PATH.set(path);
}

pub fn log(message: &str) {
    let line = format!("{} {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), message);
    eprintln!("pausa: {line}");
    if let Some(path) = LOG_PATH.get() {
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }
}

/// The newest `max_lines` lines, capped in size.
pub fn tail(max_lines: usize) -> String {
    let Some(path) = LOG_PATH.get() else {
        return String::new();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    let joined = lines[lines.len().saturating_sub(max_lines)..].join("\n");
    let mut start = joined.len().saturating_sub(MAX_REPORT_CHARS);
    while !joined.is_char_boundary(start) {
        start += 1;
    }
    joined[start..].to_string()
}
