#!/usr/bin/env node
// Smoke test for the deployed submit-feedback function and the table's privacy.
//
//   node scripts/smoke-test-feedback.mjs <project-ref>
//
// The function has no access code (the installer is public). Needs `supabase login` for the anon key
// check. Sends one real test report, whose message starts with "[smoke test]". Never prints any key.

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ref = process.argv[2];
if (!ref) {
  console.error("usage: node scripts/smoke-test-feedback.mjs <project-ref>");
  process.exit(2);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const base = `https://${ref}.supabase.co`;
const url = `${base}/functions/v1/submit-feedback`;
const installId = randomUUID(); // a fresh install, so earlier runs never count against it
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const post = (body) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ install_id: installId, ...body }) });

// 1. no install id
let r = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ kind: "bug", message: "[smoke test] no install id" }),
});
check("a report without an install id is rejected", r.status === 400, `status ${r.status}`);

// 2. invalid body
r = await post({ kind: "nonsense", message: "" });
check("an invalid report is rejected", r.status === 400, `status ${r.status}`);

// 3. a valid report
r = await post({
  kind: "feedback",
  message: "[smoke test] automated check, safe to delete",
  app_version: "0.1.0-beta.1",
  os_version: "test",
  settings: { interval_minutes: 60 },
  log_tail: "smoke test",
});
check("a valid report is accepted", r.status === 200, `status ${r.status}`);

// 4. oversized screenshot (about 3 MB of bytes)
r = await post({ kind: "bug", message: "[smoke test] big screenshot", screenshot_base64: Buffer.alloc(3 * 1024 * 1024, 1).toString("base64") });
check("a screenshot over 2 MB is rejected", r.status === 413, `status ${r.status}`);

// 5. a screenshot that is not an image
r = await post({ kind: "bug", message: "[smoke test] not an image", screenshot_base64: Buffer.from("just text, not a png").toString("base64") });
check("a screenshot that is not a PNG or JPEG is rejected", r.status === 400, `status ${r.status}`);

// 6. the per-install hourly limit (5 by default): this install has sent one report, so five more must hit it
let limited = false;
for (let i = 0; i < 6 && !limited; i++) {
  r = await post({ kind: "feedback", message: `[smoke test] limit probe ${i + 1}, safe to delete` });
  limited = r.status === 429;
}
check("one install is limited after a few reports", limited, `last status ${r.status}`);

// 7. privacy: the public anon key must not be able to read the table
try {
  const keys = JSON.parse(
    execFileSync(join(root, "node_modules/.bin/supabase"), ["projects", "api-keys", "--project-ref", ref, "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
  const list = Array.isArray(keys) ? keys : keys.keys ?? keys.api_keys ?? [];
  const anon = list.find((k) => k.name === "anon")?.api_key;
  if (!anon) throw new Error("anon key not found");
  const res = await fetch(`${base}/rest/v1/feedback?select=id&limit=1`, { headers: { apikey: anon, authorization: `Bearer ${anon}` } });
  const text = await res.text();
  const leaked = res.ok && text.trim() !== "[]";
  check("the anon key cannot read feedback rows", !leaked, `status ${res.status}, ${res.ok ? "empty result" : "refused"}`);
  const write = await fetch(`${base}/rest/v1/feedback`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "bug", message: "[smoke test] anon write" }),
  });
  check("the anon key cannot write feedback rows", !write.ok, `status ${write.status}`);
  const shots = await fetch(`${base}/storage/v1/object/list/feedback-screenshots`, {
    method: "POST",
    headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1 }),
  });
  const shotsText = await shots.text();
  check("the anon key cannot list screenshots", !shots.ok || shotsText.trim() === "[]", `status ${shots.status}`);
} catch (e) {
  check("the anon key privacy check ran", false, e.message);
}

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
