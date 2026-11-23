import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { rateLimit } from "../_shared/rate-limiter.ts";

// Closed-test feedback intake. The app sends a JSON body; this function validates it,
// optionally stores a screenshot, and inserts one row with the service role key,
// which never leaves the server.

const MAX_MESSAGE = 4000;
const MAX_CONTACT = 200;
const MAX_LOG = 20000;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null;

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** A limit from the environment, or its default when unset or not a positive number. */
const limit = (name: string, fallback: number): number => {
  const n = Number(Deno.env.get(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // The installer is public, so there is no access code to extract. Protection is on this side:
  // a kill switch, a per-IP rate limit, and counted limits per install and overall (below).
  if (Deno.env.get("FEEDBACK_ENABLED") === "false") return json({ error: "Feedback is switched off" }, 503);

  const { allowed, retryAfter } = rateLimit(req);
  if (!allowed) return json({ error: "Rate limit exceeded" }, 429, { "Retry-After": String(retryAfter) });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const kind = body.kind === "bug" || body.kind === "feedback" ? body.kind : null;
  const message = str(body.message, MAX_MESSAGE);
  if (!kind || !message) return json({ error: "A kind and a message are required" }, 400);

  // Every real install sends its random id, so a report without one is not from the app
  if (!isUuid(body.install_id)) return json({ error: "An install id is required" }, 400);
  const installId = body.install_id;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Counted limits, kept in the database so they hold across function instances. An install id can be
  // made up, so the overall daily caps are what stop a flood.
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  // deno-lint-ignore no-explicit-any
  const count = async (build: (q: any) => any) => {
    const { count: n, error: countError } = await build(
      supabase.from("feedback").select("id", { count: "exact", head: true }),
    );
    if (countError) throw new Error("count failed");
    return n ?? 0;
  };
  try {
    const [installHour, installDay, allDay] = await Promise.all([
      count((q) => q.eq("install_id", installId).gte("created_at", hourAgo)),
      count((q) => q.eq("install_id", installId).gte("created_at", dayAgo)),
      count((q) => q.gte("created_at", dayAgo)),
    ]);
    if (
      installHour >= limit("FEEDBACK_MAX_PER_INSTALL_HOUR", 5) ||
      installDay >= limit("FEEDBACK_MAX_PER_INSTALL_DAY", 15) ||
      allDay >= limit("FEEDBACK_MAX_PER_DAY", 300)
    ) {
      return json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "3600" });
    }
  } catch (e) {
    console.error("limit check failed", (e as Error).message);
    return json({ error: "Could not save feedback" }, 500);
  }
  const wantsScreenshot = typeof body.screenshot_base64 === "string" && body.screenshot_base64.length > 0;
  if (wantsScreenshot) {
    try {
      const shotsToday = await count((q) => q.not("screenshot_path", "is", null).gte("created_at", dayAgo));
      if (shotsToday >= limit("FEEDBACK_MAX_SCREENSHOTS_DAY", 60)) {
        return json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "3600" });
      }
    } catch (e) {
      console.error("limit check failed", (e as Error).message);
      return json({ error: "Could not save feedback" }, 500);
    }
  }

  // Optional screenshot: base64 PNG or JPEG, checked by size and by its magic bytes.
  let screenshotPath: string | null = null;
  if (typeof body.screenshot_base64 === "string" && body.screenshot_base64.length > 0) {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(body.screenshot_base64), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: "Invalid screenshot" }, 400);
    }
    if (bytes.length > MAX_SCREENSHOT_BYTES) return json({ error: "Screenshot is larger than 2 MB" }, 413);
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpg) return json({ error: "Screenshot must be a PNG or JPEG" }, 400);

    screenshotPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${isPng ? "png" : "jpg"}`;
    const { error: uploadError } = await supabase.storage
      .from("feedback-screenshots")
      .upload(screenshotPath, bytes, { contentType: isPng ? "image/png" : "image/jpeg" });
    if (uploadError) {
      console.error("screenshot upload failed", uploadError.message);
      screenshotPath = null; // still keep the written feedback
    }
  }

  const settings = body.settings && typeof body.settings === "object" ? body.settings : null;
  const { error } = await supabase.from("feedback").insert({
    kind,
    message,
    contact: str(body.contact, MAX_CONTACT),
    install_id: installId,
    app_version: str(body.app_version, 40),
    os_version: str(body.os_version, 40),
    settings,
    log_tail: str(body.log_tail, MAX_LOG),
    screenshot_path: screenshotPath,
  });

  if (error) {
    console.error("insert failed", error.message);
    return json({ error: "Could not save feedback" }, 500);
  }
  return json({ ok: true });
});
