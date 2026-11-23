interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();

const MAX_TOKENS = 30; // max requests per window
const REFILL_RATE = 0.5; // tokens per second (30 per minute = 0.5/s)
const BURST_LIMIT = 5; // max burst within a short period

const burstTracker = new Map<string, number[]>();

function getClientId(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function refillBucket(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + elapsed * REFILL_RATE);
  bucket.lastRefill = now;
}

function checkBurst(clientId: string): boolean {
  const now = Date.now();
  const timestamps = burstTracker.get(clientId) || [];

  // Keep only timestamps from the last 60 seconds
  const recent = timestamps.filter((t) => now - t < 60_000);
  burstTracker.set(clientId, recent);

  return recent.length < BURST_LIMIT;
}

export function rateLimit(req: Request): { allowed: boolean; retryAfter?: number } {
  const clientId = getClientId(req);

  // Check burst limit
  if (!checkBurst(clientId)) {
    return { allowed: false, retryAfter: 60 };
  }

  // Get or create bucket
  let bucket = buckets.get(clientId);
  if (!bucket) {
    bucket = { tokens: MAX_TOKENS, lastRefill: Date.now() };
    buckets.set(clientId, bucket);
  }

  refillBucket(bucket);

  if (bucket.tokens < 1) {
    const retryAfter = Math.ceil((1 - bucket.tokens) / REFILL_RATE);
    return { allowed: false, retryAfter };
  }

  bucket.tokens -= 1;

  // Track burst
  const timestamps = burstTracker.get(clientId) || [];
  timestamps.push(Date.now());
  burstTracker.set(clientId, timestamps);

  return { allowed: true };
}
