#!/usr/bin/env node
// Read-only report of the feedback people sent from the app.
//
//   npm run feedback:report
//   npm run feedback:report -- --days 7 --kind bug
//   npm run feedback:report -- --since 2026-11-25 --out feedback-export/week-1.md
//
// It only sends GET requests and never writes to Supabase. It needs the service role key,
// because the table has row level security and no policies on purpose. Put it in
// supabase/.env (git-ignored) as:
//
//   SUPABASE_SERVICE_ROLE_KEY=<Project Settings > API > service_role>
//
// The project URL comes from PAUSA_FEEDBACK_URL (env or supabase/.env). The key is never printed. The report is written to feedback-export/
// (git-ignored), because feedback is free text and may contain personal data. Delete it when done.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- arguments ----
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

if (flag("help")) {
  console.log(
    "usage: npm run feedback:report -- [--days N | --since YYYY-MM-DD] [--kind bug|feedback] [--include-tests] [--out file.md]",
  );
  process.exit(0);
}

const kind = opt("kind");
if (kind && kind !== "bug" && kind !== "feedback") {
  console.error('--kind must be "bug" or "feedback"');
  process.exit(2);
}
let since;
if (opt("since")) {
  since = new Date(`${opt("since")}T00:00:00Z`);
  if (Number.isNaN(since.getTime())) {
    console.error("--since must look like 2026-11-25");
    process.exit(2);
  }
} else {
  const days = Number(opt("days") ?? 14);
  if (!Number.isFinite(days) || days <= 0) {
    console.error("--days must be a positive number");
    process.exit(2);
  }
  since = new Date(Date.now() - days * 86400000);
}

// ---- config (env first, then supabase/.env) ----
const envFile = join(root, "supabase/.env");
const fileEnv = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const fromFile = (k) => fileEnv.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || fromFile("SUPABASE_SERVICE_ROLE_KEY");
const base = (process.env.PAUSA_FEEDBACK_URL || fromFile("PAUSA_FEEDBACK_URL") || "").replace(/\/$/, "");
if (!base) {
  console.error("PAUSA_FEEDBACK_URL not found. Set it in the environment or in supabase/.env.");
  process.exit(2);
}
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY not found. Add it to supabase/.env (see the header of this script).");
  process.exit(2);
}

// ---- fetch (GET only, paged) ----
async function fetchAll() {
  const rows = [];
  const page = 500;
  for (let from = 0; ; from += page) {
    const params = new URLSearchParams({ select: "*", order: "created_at.desc" });
    params.append("created_at", `gte.${since.toISOString()}`);
    if (kind) params.append("kind", `eq.${kind}`);
    const res = await fetch(`${base}/rest/v1/feedback?${params}`, {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + page - 1}`, "Range-Unit": "items" },
    });
    if (res.status === 401 || res.status === 403) {
      console.error("Supabase refused the key (HTTP " + res.status + "). Check SUPABASE_SERVICE_ROLE_KEY.");
      process.exit(1);
    }
    if (!res.ok && res.status !== 206) {
      console.error("Request failed: HTTP " + res.status);
      process.exit(1);
    }
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

let rows = await fetchAll();
const testCount = rows.filter((r) => r.message.startsWith("[smoke test]")).length;
if (!flag("include-tests")) rows = rows.filter((r) => !r.message.startsWith("[smoke test]"));

// ---- summary ----
const count = (list, f) => {
  const m = new Map();
  for (const r of list) {
    const k = f(r) ?? "unknown";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const line = (entries) => entries.map(([k, n]) => `${k} (${n})`).join(", ") || "none";
const installs = new Set(rows.map((r) => r.install_id).filter(Boolean));
const byDay = count(rows, (r) => r.created_at.slice(0, 10)).sort((a, b) => a[0].localeCompare(b[0]));

const summary = [
  `Since ${since.toISOString().slice(0, 10)}${kind ? `, only ${kind}` : ""}`,
  `Reports: ${rows.length} (${line(count(rows, (r) => r.kind))})`,
  `Distinct installs: ${installs.size}`,
  `App versions: ${line(count(rows, (r) => r.app_version))}`,
  `macOS: ${line(count(rows, (r) => r.os_version))}`,
  `With screenshot: ${rows.filter((r) => r.screenshot_path).length}`,
  `With a contact: ${rows.filter((r) => r.contact).length}`,
  `Per day: ${line(byDay)}`,
  testCount && !flag("include-tests") ? `(${testCount} smoke-test report(s) hidden; use --include-tests)` : null,
].filter(Boolean);

// ---- markdown report ----
const tail = (s, n) => (s ? s.split("\n").slice(-n).join("\n") : "");
const md = [
  "# Pausa feedback report",
  "",
  `Generated ${new Date().toISOString()}. Contains free text that may be personal: do not share or commit, delete when done.`,
  "",
  ...summary.map((s) => `- ${s}`),
  "",
];
for (const r of rows) {
  md.push(
    `## ${r.kind === "bug" ? "Bug" : "Feedback"}, ${r.created_at.slice(0, 16).replace("T", " ")} UTC`,
    "",
    `Install ${r.install_id ? r.install_id.slice(0, 8) : "unknown"}, app ${r.app_version ?? "?"}, macOS ${r.os_version ?? "?"}` +
      (r.contact ? `, contact: ${r.contact}` : ""),
    "",
    r.message,
    "",
  );
  if (r.settings) md.push("Settings: `" + JSON.stringify(r.settings) + "`", "");
  if (r.screenshot_path) md.push(`Screenshot: bucket feedback-screenshots, path ${r.screenshot_path} (open it in the Supabase dashboard, Storage)`, "");
  if (r.log_tail) md.push("<details><summary>Log, last lines</summary>", "", "```", tail(r.log_tail, 15), "```", "</details>", "");
}

const outPath = opt("out") ?? join("feedback-export", `feedback-${new Date().toISOString().slice(0, 10)}.md`);
const outAbs = join(root, outPath);
mkdirSync(dirname(outAbs), { recursive: true });
writeFileSync(outAbs, md.join("\n"));

// ---- terminal output ----
console.log(summary.join("\n"));
console.log("");
for (const r of rows.slice(0, 10)) {
  const text = r.message.replace(/\s+/g, " ");
  console.log(`[${r.kind}] ${r.created_at.slice(0, 10)}  ${text.length > 110 ? text.slice(0, 110) + "..." : text}`);
}
if (rows.length > 10) console.log(`... and ${rows.length - 10} more in the report`);
console.log(`\nFull report: ${outPath}`);
