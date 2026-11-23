use chrono::Timelike;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tip {
    pub id: u32,
    pub text: String,
    pub category: String,
    #[serde(rename = "timeOfDay")]
    pub time_of_day: Vec<String>,
    pub duration: String,
    /// Guided breathing pattern ("box", "478", "coherent", "sigh", ...), if this tip is a technique.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technique: Option<String>,
    /// Safety note to show with the tip: "breath-hold", "movement" or "eyes-closed".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caution: Option<String>,
    /// "approved" tips ship; "draft" tips wait for a human review and are never shown.
    #[serde(default = "approved")]
    pub status: String,
}

fn approved() -> String {
    "approved".into()
}

/// Every entry in the bundled file, drafts included.
fn parse_all() -> Vec<Tip> {
    let json = include_str!("../../src/data/tips.json");
    serde_json::from_str(json).unwrap_or_default()
}

/// The tips the app may show: approved ones only.
pub fn load_tips() -> Vec<Tip> {
    parse_all().into_iter().filter(|t| t.status == "approved").collect()
}

pub fn get_time_of_day() -> String {
    let hour = chrono::Local::now().hour();
    match hour {
        5..=11 => "morning".to_string(),
        12..=16 => "afternoon".to_string(),
        17..=20 => "evening".to_string(),
        _ => "night".to_string(),
    }
}

/// How much more or less likely a category is, from what this user completed (+1) or skipped (-1).
/// Stays between 0.25x and 2.5x so no category ever disappears or takes over.
fn weight(affinity: &HashMap<String, i32>, category: &str) -> f64 {
    let a = affinity.get(category).copied().unwrap_or(0).clamp(-3, 6);
    (1.0 + 0.25 * a as f64).max(0.25)
}

/// Pick a tip. `roll` is a random number in [0, 1); passing it in keeps the choice testable.
fn pick(
    tips: &[Tip],
    categories: &[String],
    recent_ids: &[u32],
    affinity: &HashMap<String, i32>,
    time: &str,
    roll: f64,
) -> Option<Tip> {
    let wanted = |t: &&Tip| categories.is_empty() || categories.contains(&t.category);

    // Best case: right category, right time of day, not shown recently.
    let mut candidates: Vec<&Tip> = tips
        .iter()
        .filter(wanted)
        .filter(|t| t.time_of_day.iter().any(|x| x == time))
        .filter(|t| !recent_ids.contains(&t.id))
        .collect();
    // Then relax: ignore the time of day, then ignore what was shown recently.
    if candidates.is_empty() {
        candidates = tips.iter().filter(wanted).filter(|t| !recent_ids.contains(&t.id)).collect();
    }
    if candidates.is_empty() {
        candidates = tips.iter().filter(wanted).collect();
    }
    if candidates.is_empty() {
        return None;
    }

    let total: f64 = candidates.iter().map(|t| weight(affinity, &t.category)).sum();
    let mut target = roll.clamp(0.0, 0.999_999) * total;
    for t in &candidates {
        target -= weight(affinity, &t.category);
        if target < 0.0 {
            return Some((*t).clone());
        }
    }
    candidates.last().map(|t| (*t).clone())
}

pub fn select_tip(
    tips: &[Tip],
    categories: &[String],
    recent_ids: &[u32],
    affinity: &HashMap<String, i32>,
) -> Option<Tip> {
    pick(tips, categories, recent_ids, affinity, &get_time_of_day(), rand::random::<f64>())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tip(id: u32, category: &str, times: &[&str]) -> Tip {
        Tip {
            id,
            text: format!("tip {id}"),
            category: category.into(),
            time_of_day: times.iter().map(|s| s.to_string()).collect(),
            duration: "30s".into(),
            technique: None,
            caution: None,
            status: "approved".into(),
        }
    }

    fn cats(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn bundled_library_parses_with_unique_ids_and_text() {
        let all = parse_all();
        assert!(all.len() > 100, "the full library should be loaded");
        let mut ids: Vec<u32> = all.iter().map(|t| t.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), all.len(), "ids must be unique");
        assert!(all.iter().all(|t| !t.text.trim().is_empty()));
    }

    #[test]
    fn drafts_are_never_loaded() {
        assert!(load_tips().iter().all(|t| t.status == "approved"));
        assert!(load_tips().len() <= parse_all().len());
    }

    #[test]
    fn respects_selected_categories() {
        let tips = vec![tip(1, "focus", &["morning"]), tip(2, "nature", &["morning"])];
        for roll in [0.0, 0.5, 0.99] {
            let t = pick(&tips, &cats(&["nature"]), &[], &HashMap::new(), "morning", roll).unwrap();
            assert_eq!(t.category, "nature");
        }
    }

    #[test]
    fn empty_category_list_means_all() {
        let tips = vec![tip(1, "focus", &["morning"])];
        assert!(pick(&tips, &[], &[], &HashMap::new(), "morning", 0.3).is_some());
    }

    #[test]
    fn prefers_the_current_time_of_day() {
        let tips = vec![tip(1, "focus", &["morning"]), tip(2, "focus", &["night"])];
        let t = pick(&tips, &[], &[], &HashMap::new(), "night", 0.1).unwrap();
        assert_eq!(t.id, 2);
    }

    #[test]
    fn falls_back_when_no_tip_fits_the_time_of_day() {
        let tips = vec![tip(1, "focus", &["morning"])];
        let t = pick(&tips, &[], &[], &HashMap::new(), "night", 0.1).unwrap();
        assert_eq!(t.id, 1);
    }

    #[test]
    fn avoids_recent_tips_when_it_can() {
        let tips = vec![tip(1, "focus", &["morning"]), tip(2, "focus", &["morning"])];
        for roll in [0.0, 0.5, 0.99] {
            let t = pick(&tips, &[], &[1], &HashMap::new(), "morning", roll).unwrap();
            assert_eq!(t.id, 2);
        }
    }

    #[test]
    fn repeats_rather_than_returning_nothing() {
        let tips = vec![tip(1, "focus", &["morning"])];
        let t = pick(&tips, &[], &[1], &HashMap::new(), "morning", 0.5).unwrap();
        assert_eq!(t.id, 1);
    }

    #[test]
    fn no_matching_category_returns_none() {
        let tips = vec![tip(1, "focus", &["morning"])];
        assert!(pick(&tips, &cats(&["nature"]), &[], &HashMap::new(), "morning", 0.5).is_none());
    }

    #[test]
    fn liked_categories_are_picked_more_often() {
        let tips = vec![tip(1, "focus", &["morning"]), tip(2, "nature", &["morning"])];
        let mut affinity = HashMap::new();
        affinity.insert("nature".to_string(), 6); // weight 2.5 against 1.0
        let n = 1000;
        let nature = (0..n)
            .filter(|i| {
                let roll = *i as f64 / n as f64;
                pick(&tips, &[], &[], &affinity, "morning", roll).unwrap().category == "nature"
            })
            .count();
        assert!(nature > 650 && nature < 750, "expected about 71%, got {nature} of {n}");
    }

    #[test]
    fn skipped_categories_never_disappear() {
        let tips = vec![tip(1, "focus", &["morning"]), tip(2, "nature", &["morning"])];
        let mut affinity = HashMap::new();
        affinity.insert("nature".to_string(), -50); // clamped to -3, weight 0.25
        let n = 1000;
        let nature = (0..n)
            .filter(|i| {
                let roll = *i as f64 / n as f64;
                pick(&tips, &[], &[], &affinity, "morning", roll).unwrap().category == "nature"
            })
            .count();
        assert!(nature > 0 && nature < 250, "got {nature} of {n}");
    }
}
