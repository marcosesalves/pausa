use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8};
use std::sync::Mutex;

/// `#[serde(default)]`: fields missing from an older saved file fall back to `Default`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub interval_minutes: u64,
    pub selected_categories: Vec<String>,
    pub launch_at_login: bool,
    pub quiet_hours_enabled: bool,
    pub quiet_hours_start: String,
    pub quiet_hours_end: String,
    pub paused: bool,
    /// What the window's close button does: "tray" hides it and keeps Pausa running, "quit" exits.
    pub close_behavior: String,
    /// The first-close explanation ("Pausa keeps running") has been shown, or dismissed for good.
    pub close_notice_seen: bool,
    /// Set once the first-launch onboarding has been completed.
    pub onboarded: bool,
    /// What the user calls their companion.
    pub companion_name: String,
    /// Show the companion character (off = a plain, character-free Pausa).
    pub show_companion: bool,
    /// "system" follows the computer's light or dark mode; "light" and "dark" force one.
    pub theme: String,
    /// A separate reminder to drink water, on its own rhythm.
    pub water_reminder: bool,
    pub water_interval_minutes: u64,
    /// A separate reminder to check your posture, on its own rhythm.
    pub posture_reminder: bool,
    pub posture_interval_minutes: u64,
    /// In the tip card: "Add a breath" before and/or after the pause, remembered per category (by id).
    pub breathe_around: HashMap<String, BreatheAround>,
}

/// A breath (a short Breathe session in the Pausa window) before and/or after the pause, for one category.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BreatheAround {
    pub before: bool,
    pub after: bool,
}

/// Growth progress. Kept apart from Settings so the popover saving settings
/// can never overwrite a count the backend just incremented.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Progress {
    /// Total pauses taken, never reset, never decreases.
    pub total_pauses: u32,
    /// Per category: +1 for each completed pause, -1 for each skipped one. Stays on this Mac
    /// and only nudges how often a category comes up.
    pub affinity: HashMap<String, i32>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            interval_minutes: 60,
            selected_categories: vec![
                "breathing".into(),
                "gratitude".into(),
                "body-scan".into(),
                "present-moment".into(),
                "compassion".into(),
                "movement".into(),
                "nature".into(),
                "journaling".into(),
                "focus".into(),
                "letting-go".into(),
            ],
            launch_at_login: false,
            quiet_hours_enabled: false,
            quiet_hours_start: "22:00".into(),
            quiet_hours_end: "07:00".into(),
            paused: false,
            close_behavior: "tray".into(),
            close_notice_seen: false,
            onboarded: false,
            companion_name: "Pip".into(),
            show_companion: true,
            theme: "system".into(),
            water_reminder: false,
            water_interval_minutes: 60,
            posture_reminder: false,
            posture_interval_minutes: 45,
            breathe_around: HashMap::new(),
        }
    }
}

/// How many history entries are kept (and written to disk).
const HISTORY_CAP: usize = 50;

/// One thing that was put in front of the user: a tip, or a Breathe session. Kept on this computer only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    /// The tip's id, or 0 for a Breathe session (which carries a `title` instead).
    pub tip_id: u32,
    pub title: Option<String>,
    /// Seconds since the Unix epoch.
    pub at: u64,
    /// "shown" (on screen, not acted on), "done" (a pause was taken) or "skipped".
    pub outcome: String,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    /// Oldest first. Persisted, so History survives a restart and tips are not repeated right after one.
    pub history: Mutex<Vec<HistoryEntry>>,
    pub progress: Mutex<Progress>,
    /// Menu bar icon animation (see tray_icon.rs).
    /// Bumped to cancel a running wake sequence; each step checks it is still current.
    pub wake_generation: AtomicU64,
    /// True while a wake sequence is playing, so the periodic refresh doesn't interrupt it.
    pub wake_active: AtomicBool,
    /// A tip arrived and the popover hasn't been opened since (the dot stays on).
    pub new_tip_pending: AtomicBool,
    /// Last glyph set on the tray, to skip redundant updates.
    pub last_glyph: AtomicU8,
    /// When the next reminder is due (seconds since the Unix epoch), or 0 before the scheduler has started.
    pub next_nudge_at: AtomicU64,
    /// Wakes the main scheduler so it starts a fresh wait, when the reminder interval was changed.
    pub reschedule: tokio::sync::Notify,
    /// The same for the water and posture reminders, each on its own so one never restarts another.
    pub reschedule_water: tokio::sync::Notify,
    pub reschedule_posture: tokio::sync::Notify,
    /// When a card last appeared (seconds since the Unix epoch), so two reminders never land together.
    pub last_card_at: AtomicU64,
}

impl Settings {
    /// The categories tips are drawn from. With none picked, Breathing is used, so a tip is never missing.
    pub fn effective_categories(&self) -> Vec<String> {
        if self.selected_categories.is_empty() {
            vec!["breathing".to_string()]
        } else {
            self.selected_categories.clone()
        }
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            wake_generation: AtomicU64::new(0),
            wake_active: AtomicBool::new(false),
            new_tip_pending: AtomicBool::new(false),
            last_glyph: AtomicU8::new(u8::MAX),
            next_nudge_at: AtomicU64::new(0),
            reschedule: tokio::sync::Notify::new(),
            reschedule_water: tokio::sync::Notify::new(),
            reschedule_posture: tokio::sync::Notify::new(),
            last_card_at: AtomicU64::new(0),
            settings: Mutex::new(Settings::default()),
            history: Mutex::new(Vec::new()),
            progress: Mutex::new(Progress::default()),
        }
    }

    pub fn get_progress(&self) -> Progress {
        self.progress.lock().unwrap().clone()
    }

    pub fn set_progress(&self, progress: Progress) {
        *self.progress.lock().unwrap() = progress;
    }

    /// Count one completed pause (and like its category a little) and return the new progress.
    pub fn record_pause(&self, category: Option<&str>) -> Progress {
        let mut progress = self.progress.lock().unwrap();
        progress.total_pauses = progress.total_pauses.saturating_add(1);
        if let Some(c) = category {
            let a = progress.affinity.entry(c.to_string()).or_insert(0);
            *a = (*a + 1).min(20);
        }
        progress.clone()
    }

    /// A tip was dismissed without being done: like its category a little less.
    pub fn record_skip(&self, category: &str) -> Progress {
        let mut progress = self.progress.lock().unwrap();
        let a = progress.affinity.entry(category.to_string()).or_insert(0);
        *a = (*a - 1).max(-10);
        progress.clone()
    }

    pub fn get_settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn update_settings(&self, new_settings: Settings) {
        let mut settings = self.settings.lock().unwrap();
        *settings = new_settings;
    }

    pub fn set_history(&self, history: Vec<HistoryEntry>) {
        *self.history.lock().unwrap() = history;
    }

    pub fn get_history(&self) -> Vec<HistoryEntry> {
        self.history.lock().unwrap().clone()
    }

    /// A tip was put on screen. Returns the whole history, to be saved.
    pub fn record_shown(&self, tip_id: u32) -> Vec<HistoryEntry> {
        self.push(HistoryEntry { tip_id, title: None, at: now_secs(), outcome: "shown".into() })
    }

    /// A Breathe session was finished: a pause that has no tip behind it.
    pub fn record_breathe(&self, title: &str) -> Vec<HistoryEntry> {
        self.push(HistoryEntry { tip_id: 0, title: Some(title.to_string()), at: now_secs(), outcome: "done".into() })
    }

    /// The most recent time this tip was only "shown" becomes "done" or "skipped". A pause finished for a
    /// tip that was never recorded (older than the history, say) is added as done, so the counts agree.
    pub fn mark_outcome(&self, tip_id: u32, outcome: &str) -> Vec<HistoryEntry> {
        {
            let mut history = self.history.lock().unwrap();
            if let Some(entry) = history.iter_mut().rev().find(|e| e.tip_id == tip_id && e.outcome == "shown") {
                entry.outcome = outcome.to_string();
                return history.clone();
            }
        }
        if outcome == "done" {
            return self.push(HistoryEntry { tip_id, title: None, at: now_secs(), outcome: "done".into() });
        }
        self.get_history()
    }

    fn push(&self, entry: HistoryEntry) -> Vec<HistoryEntry> {
        let mut history = self.history.lock().unwrap();
        history.push(entry);
        if history.len() > HISTORY_CAP {
            let extra = history.len() - HISTORY_CAP;
            history.drain(..extra);
        }
        history.clone()
    }

    /// Tips shown lately, so the picker avoids repeating them (Breathe sessions are not tips).
    pub fn get_recent_tip_ids(&self) -> Vec<u32> {
        self.history.lock().unwrap().iter().filter(|e| e.tip_id != 0).map(|e| e.tip_id).collect()
    }
}

#[cfg(test)]
mod history_tests {
    use super::*;

    fn outcomes(state: &AppState) -> Vec<(u32, String)> {
        state.get_history().into_iter().map(|e| (e.tip_id, e.outcome)).collect()
    }

    #[test]
    fn a_finished_pause_marks_its_tip_done() {
        let state = AppState::new();
        state.record_shown(7);
        state.mark_outcome(7, "done");
        assert_eq!(outcomes(&state), vec![(7, "done".to_string())]);
    }

    #[test]
    fn only_the_latest_showing_of_a_tip_is_marked() {
        let state = AppState::new();
        state.record_shown(7);
        state.record_shown(7);
        state.mark_outcome(7, "skipped");
        assert_eq!(outcomes(&state), vec![(7, "shown".to_string()), (7, "skipped".to_string())]);
    }

    #[test]
    fn a_pause_for_an_unrecorded_tip_still_counts_as_done() {
        let state = AppState::new();
        state.mark_outcome(9, "done");
        assert_eq!(outcomes(&state), vec![(9, "done".to_string())]);
    }

    #[test]
    fn a_skip_for_an_unrecorded_tip_adds_nothing() {
        let state = AppState::new();
        state.mark_outcome(9, "skipped");
        assert!(state.get_history().is_empty());
    }

    #[test]
    fn a_breathe_session_is_a_done_entry_but_not_a_tip_to_avoid_repeating() {
        let state = AppState::new();
        state.record_breathe("Box breathing");
        state.record_shown(3);
        assert_eq!(state.get_history()[0].title.as_deref(), Some("Box breathing"));
        assert_eq!(state.get_history()[0].outcome, "done");
        assert_eq!(state.get_recent_tip_ids(), vec![3]);
    }

    #[test]
    fn history_keeps_only_the_newest_fifty() {
        let state = AppState::new();
        for id in 1..=60 {
            state.record_shown(id);
        }
        let history = state.get_history();
        assert_eq!(history.len(), 50);
        assert_eq!(history.first().map(|e| e.tip_id), Some(11));
        assert_eq!(history.last().map(|e| e.tip_id), Some(60));
    }
}

#[cfg(test)]
mod breathe_around_tests {
    use super::*;

    #[test]
    fn a_settings_file_from_before_this_field_still_loads_with_no_choices() {
        let old = r#"{ "interval_minutes": 30, "paused": true }"#;
        let settings: Settings = serde_json::from_str(old).unwrap();
        assert_eq!(settings.interval_minutes, 30);
        assert!(settings.paused);
        assert!(settings.breathe_around.is_empty(), "the card works as before: nothing added");
        assert_eq!(settings.theme, "system");
        assert!(!settings.water_reminder && !settings.posture_reminder);
    }

    #[test]
    fn choices_are_kept_per_category_and_survive_saving() {
        let mut settings = Settings::default();
        settings.breathe_around.insert("gratitude".into(), BreatheAround { before: true, after: false });
        settings.breathe_around.insert("movement".into(), BreatheAround { before: false, after: true });
        let json = serde_json::to_string(&settings).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.breathe_around["gratitude"], BreatheAround { before: true, after: false });
        assert_eq!(back.breathe_around["movement"], BreatheAround { before: false, after: true });
        assert!(!back.breathe_around.contains_key("nature"));
    }
}
