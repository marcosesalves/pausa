#!/usr/bin/env node
// Validates src/data/tips.json. No dependencies.
//
//   node scripts/validate-tips.mjs               check the library (exit 1 on any error)
//   node scripts/validate-tips.mjs --review      also write docs/tips-review.md (the review table for draft tips)
//   node scripts/validate-tips.mjs --approve-drafts   mark every draft as approved with today's date
//                                                     (run it only AFTER a human has reviewed them)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tipsPath = process.env.TIPS_FILE ?? join(root, "src/data/tips.json"); // TIPS_FILE is for testing the validator itself
const tips = JSON.parse(readFileSync(tipsPath, "utf8"));

const CATEGORIES = [
  "breathing", "gratitude", "body-scan", "present-moment", "compassion",
  "movement", "nature", "journaling", "focus", "letting-go",
];
const TIMES = ["morning", "afternoon", "evening", "night"];
const TECHNIQUES = ["box", "478", "coherent", "sigh", "longexhale", "triangle"];
const CAUTIONS = ["breath-hold", "movement", "eyes-closed"];
const STATUSES = ["approved", "draft"];
const MAX_LENGTH = 150;
const NEAR_DUPLICATE = 0.8; // word-set similarity at or above this is flagged

// Wording that would turn a gentle tip into a health claim. Pausa is not a medical tool.
const BANNED = /\b(cure[sd]?|treat(s|ed|ing|ment)?|heal(s|ed|ing)?|diagnos\w*|clinical(ly)?|proven|therap(y|ies|eutic)|disorder|depress\w*|anxiety|panic attacks?|medicat\w*|prescri\w*|trauma|symptoms?|guarantee[sd]?)\b/i;

const errors = [];
const warnings = [];
const err = (tip, msg) => errors.push(`#${tip.id}: ${msg}`);

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => new Set(normalize(s).split(" ").filter((w) => w.length > 2));
const similarity = (a, b) => {
  const A = words(a), B = words(b);
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / (new Set([...A, ...B]).size || 1);
};

const ids = new Set();
for (const tip of tips) {
  if (!Number.isInteger(tip.id) || tip.id <= 0) err(tip, "id must be a positive integer");
  if (ids.has(tip.id)) err(tip, "duplicate id");
  ids.add(tip.id);

  if (typeof tip.text !== "string" || tip.text.trim() === "") err(tip, "text is empty");
  else {
    if (tip.text.length > MAX_LENGTH) err(tip, `text is ${tip.text.length} characters (max ${MAX_LENGTH})`);
    const banned = tip.text.match(BANNED);
    if (banned) err(tip, `risky wording "${banned[0]}": avoid health claims`);
    if (/\s{2,}|^\s|\s$/.test(tip.text)) err(tip, "stray whitespace in text");
  }
  if (!CATEGORIES.includes(tip.category)) err(tip, `unknown category "${tip.category}"`);
  if (!Array.isArray(tip.timeOfDay) || tip.timeOfDay.length === 0) err(tip, "timeOfDay is empty");
  else for (const t of tip.timeOfDay) if (!TIMES.includes(t)) err(tip, `unknown time of day "${t}"`);
  if (!/^\d+\s?(s|min)$/.test(tip.duration ?? "")) err(tip, `duration "${tip.duration}" must look like 30s or 1 min`);
  if (tip.technique !== undefined) {
    if (!TECHNIQUES.includes(tip.technique)) err(tip, `unknown technique "${tip.technique}"`);
    if (tip.category !== "breathing") err(tip, "a technique tip must be in the breathing category");
  }
  if (tip.caution !== undefined && !CAUTIONS.includes(tip.caution)) err(tip, `unknown caution "${tip.caution}"`);
  if (!STATUSES.includes(tip.status)) err(tip, `status must be one of ${STATUSES.join(", ")}`);
  if (/\b(hold|holding)\b/i.test(tip.text) && /\bbreath/i.test(tip.text) && tip.caution !== "breath-hold") {
    err(tip, 'mentions holding the breath but has no "breath-hold" caution');
  }
  if (/close your eyes/i.test(tip.text) && tip.caution !== "eyes-closed") {
    err(tip, 'asks to close the eyes but has no "eyes-closed" caution');
  }
}

// Duplicates and near-duplicates
for (let i = 0; i < tips.length; i++) {
  for (let j = i + 1; j < tips.length; j++) {
    const a = tips[i], b = tips[j];
    if (normalize(a.text) === normalize(b.text)) errors.push(`#${a.id} and #${b.id}: identical text`);
    else if (a.technique && b.technique) continue; // technique tips share the "in for 4, out for 4" pattern on purpose
    else if (similarity(a.text, b.text) >= NEAR_DUPLICATE) {
      errors.push(`#${a.id} and #${b.id}: near-duplicate (${Math.round(similarity(a.text, b.text) * 100)}% shared words)`);
    }
  }
}

// ----- optional actions
const args = new Set(process.argv.slice(2));

// Coverage: only approved tips ship, so each category needs enough of them to feel varied and
// every time of day needs some. While drafts are under review this only warns; with --strict
// (use it before a release) it fails.
const approved = tips.filter((t) => t.status === "approved");
const coverage = args.has("--strict") ? errors : warnings;
for (const c of CATEGORIES) {
  const n = approved.filter((t) => t.category === c).length;
  if (n < 8) coverage.push(`category "${c}" has only ${n} approved tips (want at least 8)`);
}
for (const t of TIMES) {
  const n = approved.filter((x) => x.timeOfDay.includes(t)).length;
  if (n < 10) coverage.push(`only ${n} approved tips for ${t} (want at least 10)`);
}

if (args.has("--review")) {
  const drafts = tips.filter((t) => t.status === "draft");
  const lines = [
    "# Tip review",
    "",
    `Generated by \`scripts/validate-tips.mjs --review\`. ${drafts.length} draft tips need a decision.`,
    "",
    "For each tip write **keep**, **edit: new text**, or **drop**. Check three things: it is kind and clear, it makes no health promise, and it does not sound copied from anywhere you have read.",
    "",
  ];
  for (const c of CATEGORIES) {
    const rows = drafts.filter((t) => t.category === c);
    if (rows.length === 0) continue;
    lines.push(`## ${c}`, "", "| id | tip | when | note | decision |", "| --- | --- | --- | --- | --- |");
    for (const t of rows) {
      const when = t.timeOfDay.map((x) => x[0].toUpperCase()).join("");
      const note = [t.technique && `technique: ${t.technique}`, t.caution && `caution: ${t.caution}`, t.duration].filter(Boolean).join(", ");
      lines.push(`| ${t.id} | ${t.text.replace(/\|/g, "\\|")} | ${when} | ${note} | |`);
    }
    lines.push("");
  }
  lines.push("_When: M morning, A afternoon, E evening, N night._", "");
  writeFileSync(join(root, "docs/tips-review.md"), lines.join("\n"));
  console.log(`Wrote docs/tips-review.md (${drafts.length} drafts)`);
}

if (args.has("--approve-drafts")) {
  const today = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const t of tips) if (t.status === "draft") { t.status = "approved"; t.reviewed = today; n++; }
  writeFileSync(tipsPath, JSON.stringify(tips, null, 2) + "\n");
  console.log(`Approved ${n} drafts, reviewed ${today}`);
}

// ----- report
const count = (f) => tips.filter(f).length;
console.log(`${tips.length} tips: ${approved.length} approved, ${count((t) => t.status === "draft")} draft`);
console.log(CATEGORIES.map((c) => `${c} ${count((t) => t.category === c)}`).join(" | "));
console.log(TIMES.map((x) => `${x} ${count((t) => t.timeOfDay.includes(x))}`).join(" | "));
for (const w of warnings) console.log(`warning: ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
if (errors.length > 0) {
  console.log(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log("tips.json is valid");
