//! What the Mac is set to do on a click, so the menu bar icon can behave in a way that works for this person.
//!
//! Pausa's icon has two jobs: a plain click shows or hides the window, and a secondary click (two-finger
//! click, a click in a trackpad corner, a mouse's right button, or Control-click) opens its menu. The
//! system turns every one of those into an ordinary click event before the app sees it, so the app cannot
//! tell them apart by itself. What it can do is read the preferences. If secondary click is switched off
//! in System Settings, the menu would be unreachable, so a plain click opens the menu instead (it begins
//! with "Show Pausa"). Tap to click only changes how a tap is felt, so the app reports it and explains
//! it in Settings rather than changing anything.
//!
//! macOS stores a preference only after it has been changed. A missing value means the macOS default:
//! two-finger secondary click on, tap to click off.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickSettings {
    /// A secondary click is possible (two fingers, a corner, or a two-button mouse).
    pub secondary_click: bool,
    /// A light tap on the trackpad counts as a click.
    pub tap_to_click: bool,
}

impl Default for ClickSettings {
    /// What other systems get: nothing to adjust.
    fn default() -> Self {
        Self { secondary_click: true, tap_to_click: true }
    }
}

/// The raw preference values, each `None` when never changed.
#[derive(Debug, Default, Clone)]
pub struct RawPrefs {
    /// TrackpadRightClick: "Click with two fingers".
    pub two_finger: Option<bool>,
    /// TrackpadCornerSecondaryClick: 0 off, 1 bottom left, 2 bottom right.
    pub corner: Option<i32>,
    /// MouseButtonMode: "TwoButton" or "OneButton".
    pub mouse_two_button: Option<bool>,
    /// Clicking: tap to click.
    pub tap: Option<bool>,
}

/// Turn raw preferences into behaviour, filling the gaps with the macOS defaults.
pub fn interpret(raw: &RawPrefs) -> ClickSettings {
    let trackpad_secondary = raw.two_finger.unwrap_or(true) || raw.corner.unwrap_or(0) != 0;
    ClickSettings {
        secondary_click: trackpad_secondary || raw.mouse_two_button.unwrap_or(false),
        tap_to_click: raw.tap.unwrap_or(false),
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::RawPrefs;

    const TRACKPAD: [&str; 2] = [
        "com.apple.AppleMultitouchTrackpad",
        "com.apple.driver.AppleBluetoothMultitouch.trackpad",
    ];
    const MOUSE: [&str; 2] = [
        "com.apple.AppleMultitouchMouse",
        "com.apple.driver.AppleBluetoothMultitouch.mouse",
    ];

    /// `defaults read <domain> <key>`, or None when the key was never set.
    fn read_key(domain: &str, key: &str) -> Option<String> {
        let output = std::process::Command::new("defaults")
            .args(["read", domain, key])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let value = String::from_utf8(output.stdout).ok()?.trim().to_string();
        (!value.is_empty()).then_some(value)
    }

    /// The first domain that has the key wins (the built-in device before a Bluetooth one).
    fn first(domains: &[&str], key: &str) -> Option<String> {
        domains.iter().find_map(|d| read_key(d, key))
    }

    pub fn read_raw() -> RawPrefs {
        RawPrefs {
            two_finger: first(&TRACKPAD, "TrackpadRightClick").map(|v| v == "1" || v.eq_ignore_ascii_case("true")),
            corner: first(&TRACKPAD, "TrackpadCornerSecondaryClick").and_then(|v| v.parse().ok()),
            mouse_two_button: first(&MOUSE, "MouseButtonMode").map(|v| v == "TwoButton"),
            tap: first(&TRACKPAD, "Clicking").map(|v| v == "1" || v.eq_ignore_ascii_case("true")),
        }
    }
}

/// Read the current settings. This runs a few short commands, so call it off the main thread.
#[cfg(target_os = "macos")]
pub fn read() -> ClickSettings {
    interpret(&mac::read_raw())
}

#[cfg(not(target_os = "macos"))]
pub fn read() -> ClickSettings {
    ClickSettings::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untouched_settings_mean_the_macos_defaults() {
        let s = interpret(&RawPrefs::default());
        assert!(s.secondary_click, "two-finger secondary click is on by default");
        assert!(!s.tap_to_click, "tap to click is off by default");
    }

    #[test]
    fn turning_secondary_click_off_everywhere_leaves_it_unavailable() {
        let s = interpret(&RawPrefs { two_finger: Some(false), corner: Some(0), ..Default::default() });
        assert!(!s.secondary_click);
    }

    #[test]
    fn a_corner_click_counts_as_a_secondary_click() {
        let s = interpret(&RawPrefs { two_finger: Some(false), corner: Some(2), ..Default::default() });
        assert!(s.secondary_click);
    }

    #[test]
    fn a_two_button_mouse_counts_even_when_the_trackpad_has_it_off() {
        let s = interpret(&RawPrefs {
            two_finger: Some(false),
            corner: Some(0),
            mouse_two_button: Some(true),
            ..Default::default()
        });
        assert!(s.secondary_click);
    }

    #[test]
    fn tap_to_click_follows_its_preference() {
        assert!(interpret(&RawPrefs { tap: Some(true), ..Default::default() }).tap_to_click);
        assert!(!interpret(&RawPrefs { tap: Some(false), ..Default::default() }).tap_to_click);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod real_mac_tests {
    use super::*;

    // Runs the real `defaults` commands against this Mac. Whatever the settings are, reading them must
    // not fail, and the result must be what interpreting the raw values gives.
    #[test]
    fn reading_this_macs_real_settings_works() {
        let raw = mac::read_raw();
        let settings = read();
        println!("raw preferences: {raw:?}");
        println!("interpreted: {settings:?}");
        assert_eq!(settings, interpret(&raw));
    }
}
