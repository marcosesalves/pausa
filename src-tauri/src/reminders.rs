//! The two separate reminders: drink water, and check your posture. They are not "pauses" (they do not
//! grow the garden or appear in History); each is a short card with one kind sentence and a way to dismiss it.

use crate::tips::Tip;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Water,
    Posture,
}

/// Gentle, never guilt-inducing. One is picked at random each time.
const WATER: &[&str] = &[
    "A few sips of water?",
    "Time for a glass of water.",
    "Water break: fill your glass and take a sip.",
    "Your body would like some water. Take a few sips.",
    "Pause for a drink of water.",
];

const POSTURE: &[&str] = &[
    "Check your posture: feet flat, back supported, shoulders down.",
    "Let your shoulders drop and unclench your jaw.",
    "Sit tall for a moment, then settle into a comfortable position.",
    "Bring your screen to eye level and soften your neck.",
    "Roll your shoulders back once, then settle in.",
];

impl Kind {
    pub fn category(self) -> &'static str {
        match self {
            Kind::Water => "water",
            Kind::Posture => "posture",
        }
    }

    fn lines(self) -> &'static [&'static str] {
        match self {
            Kind::Water => WATER,
            Kind::Posture => POSTURE,
        }
    }

    /// Stable ids well away from the bundled tips, so a reminder can never be mistaken for one.
    fn id(self) -> u32 {
        match self {
            Kind::Water => 9001,
            Kind::Posture => 9002,
        }
    }
}

/// The card's content. `roll` is a random number in [0, 1); passing it in keeps the choice testable.
fn tip_with(kind: Kind, roll: f64) -> Tip {
    let lines = kind.lines();
    let index = ((roll * lines.len() as f64) as usize).min(lines.len() - 1);
    Tip {
        id: kind.id(),
        text: lines[index].to_string(),
        category: kind.category().to_string(),
        time_of_day: Vec::new(),
        duration: String::new(),
        technique: None,
        caution: None,
        status: "approved".into(),
    }
}

pub fn tip_for(kind: Kind) -> Tip {
    tip_with(kind, rand::random::<f64>())
}

/// True for the cards made here, so the card can skip pause-only things (the timer, History, breathing).
pub fn is_reminder_category(category: &str) -> bool {
    category == "water" || category == "posture"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_has_its_own_category_and_id() {
        let water = tip_with(Kind::Water, 0.0);
        let posture = tip_with(Kind::Posture, 0.0);
        assert_eq!(water.category, "water");
        assert_eq!(posture.category, "posture");
        assert_ne!(water.id, posture.id);
        assert!(is_reminder_category(&water.category) && is_reminder_category(&posture.category));
        assert!(!is_reminder_category("breathing"));
    }

    #[test]
    fn the_roll_picks_every_line_and_never_runs_off_the_end() {
        assert_eq!(tip_with(Kind::Water, 0.0).text, WATER[0]);
        assert_eq!(tip_with(Kind::Water, 0.9999).text, WATER[WATER.len() - 1]);
        assert_eq!(tip_with(Kind::Posture, 1.0).text, POSTURE[POSTURE.len() - 1]);
    }

    #[test]
    fn reminder_ids_do_not_collide_with_the_bundled_tips() {
        let ids: Vec<u32> = crate::tips::load_tips().iter().map(|t| t.id).collect();
        assert!(!ids.contains(&tip_with(Kind::Water, 0.5).id));
        assert!(!ids.contains(&tip_with(Kind::Posture, 0.5).id));
    }
}
