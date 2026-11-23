use std::sync::atomic::Ordering;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::reminders::{self, Kind};
use crate::state::AppState;
use crate::tips;

pub async fn run(app: AppHandle) {
    let all_tips = tips::load_tips();

    loop {
        let settings = {
            let state = app.state::<AppState>();
            state.get_settings()
        };

        let interval = Duration::from_secs(settings.interval_minutes * 60);
        // Remember when this wait ends, so the window can say "Next nudge in 42 min"
        let due = SystemTime::now()
            .checked_add(interval)
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let state = app.state::<AppState>();
        state.next_nudge_at.store(due, Ordering::SeqCst);
        // A changed interval cuts the wait short, so the new rhythm starts from now instead of
        // after whatever was left of the old one
        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = state.reschedule.notified() => continue,
        }

        // Re-read settings in case they changed during sleep
        let settings = {
            let state = app.state::<AppState>();
            state.get_settings()
        };

        if settings.paused {
            continue;
        }

        // Check quiet hours
        if settings.quiet_hours_enabled && is_quiet_hours(&settings.quiet_hours_start, &settings.quiet_hours_end) {
            continue;
        }

        let recent_ids = {
            let state = app.state::<AppState>();
            state.get_recent_tip_ids()
        };

        let affinity = app.state::<AppState>().get_progress().affinity;
        if let Some(tip) = tips::select_tip(&all_tips, &settings.effective_categories(), &recent_ids, &affinity) {
            // Remember this tip, so History shows it and it isn't repeated soon
            crate::commands::persist_history(&app, app.state::<AppState>().record_shown(tip.id));

            // Focus notification (falls back to a native one) and tell the popover
            crate::commands::notify(&app, &tip);
        }
    }
}

/// The water and posture reminders: each runs on its own rhythm, only while switched on, and stays
/// silent while Pausa is paused or in quiet hours.
pub async fn run_reminder(app: AppHandle, kind: Kind) {
    loop {
        let state = app.state::<AppState>();
        let wake = match kind {
            Kind::Water => &state.reschedule_water,
            Kind::Posture => &state.reschedule_posture,
        };
        let settings = state.get_settings();
        let (on, minutes) = match kind {
            Kind::Water => (settings.water_reminder, settings.water_interval_minutes),
            Kind::Posture => (settings.posture_reminder, settings.posture_interval_minutes),
        };

        if !on {
            // Switched off: sleep until the settings change
            wake.notified().await;
            continue;
        }

        let interval = Duration::from_secs(minutes.max(5) * 60);
        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = wake.notified() => continue, // the rhythm or the switch changed: start again
        }

        // Re-read in case something changed during the wait
        let settings = state.get_settings();
        let still_on = match kind {
            Kind::Water => settings.water_reminder,
            Kind::Posture => settings.posture_reminder,
        };
        if !still_on || settings.paused {
            continue;
        }
        if settings.quiet_hours_enabled && is_quiet_hours(&settings.quiet_hours_start, &settings.quiet_hours_end) {
            continue;
        }

        keep_clear_of_other_cards(&app).await;
        crate::commands::show_reminder(&app, &reminders::tip_for(kind));
    }
}

/// If another card appeared less than 90 seconds ago, wait for it to go (looking every 30 seconds, for
/// at most three minutes), so two reminders never land together.
async fn keep_clear_of_other_cards(app: &AppHandle) {
    for _ in 0..6 {
        let last = app.state::<AppState>().last_card_at.load(Ordering::SeqCst);
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        if now >= last + 90 {
            return;
        }
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

pub fn is_quiet_hours(start: &str, end: &str) -> bool {
    use chrono::{Local, Timelike};

    let now = Local::now();
    let current_minutes = now.hour() * 60 + now.minute();

    let parse_time = |s: &str| -> u32 {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() == 2 {
            let h: u32 = parts[0].parse().unwrap_or(0);
            let m: u32 = parts[1].parse().unwrap_or(0);
            h * 60 + m
        } else {
            0
        }
    };

    let start_min = parse_time(start);
    let end_min = parse_time(end);

    if start_min <= end_min {
        // Same day range: e.g., 09:00 - 17:00
        current_minutes >= start_min && current_minutes < end_min
    } else {
        // Overnight range: e.g., 22:00 - 07:00
        current_minutes >= start_min || current_minutes < end_min
    }
}
