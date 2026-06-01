import { type NextRequest } from "next/server";
import { jsonWithCorrelation, getCorrelationId } from "@/lib/observability";
import { getRemoteAgentsBackend } from "@/lib/backend";
import type { RemoteApprovalOverview } from "@/lib/types";

const FRESH_TTL_MS = 2_000;   // return from cache with no relay call
const STALE_TTL_MS = 30_000;  // stale data is safe to serve up to 30s after fetch
const RELAY_TIMEOUT_MS = 3_000;
const BUST_TIMEOUT_MS = 5_000; // bust=1 allows slightly longer to force-refresh

interface CacheEntry {
  value: RemoteApprovalOverview;
  fetchedAt: number;
  expiresAt: number;  // end of fresh window
  staleUntil: number; // hard expiry
}

let cached: CacheEntry | null = null;
let inFlight: Promise<RemoteApprovalOverview> | null = null;

function makeEntry(value: RemoteApprovalOverview): CacheEntry {
  const now = Date.now();
  return { value, fetchedAt: now, expiresAt: now + FRESH_TTL_MS, staleUntil: now + STALE_TTL_MS };
}

async function doFetch(timeoutMs: number): Promise<RemoteApprovalOverview> {
  if (!inFlight) {
    inFlight = (async () => {
      const { getRemoteApprovalOverview } = await getRemoteAgentsBackend();
      return getRemoteApprovalOverview();
    })()
      .then((value) => {
        cached = makeEntry(value);
        return value;
      })
      .finally(() => { inFlight = null; });
  }
  return Promise.race([
    inFlight,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("relay_timeout")), timeoutMs),
    ),
  ]);
}

// Warm the relay connection + cache on module load so the first request is fast.
void doFetch(RELAY_TIMEOUT_MS).catch(() => { /* non-fatal */ });

// Fix 1: HEAD returns 200 immediately — dashboard liveness only, does NOT call relay.
export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 200 });
}

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const bust = request.nextUrl.searchParams.get("bust") === "1";
  const nologs = request.nextUrl.searchParams.get("nologs") === "1";
  const now = Date.now();

  const makeResponse = (
    value: RemoteApprovalOverview,
    cacheStatus: "hit" | "stale" | "miss",
  ) => {
    const ageMs = cached ? Math.max(0, Date.now() - cached.fetchedAt) : 0;
    const result = nologs ? stripLogs(value) : value;
    return jsonWithCorrelation(result, {
      status: 200,
      headers: {
        "X-VI-Cache": cacheStatus,
        "X-VI-Cache-Age-Ms": String(ageMs),
      },
    }, correlationId);
  };

  // 1. Fresh hit — return immediately, no relay call
  if (!bust && cached && cached.expiresAt > now) {
    return makeResponse(cached.value, "hit");
  }

  // 2. Stale hit — kick background refresh, return stale immediately (<50ms)
  if (!bust && cached && cached.staleUntil > now) {
    void doFetch(RELAY_TIMEOUT_MS).catch(() => { /* background — non-fatal */ });
    return makeResponse(cached.value, "stale");
  }

  // 3. Miss (or bust=1) — await relay with timeout
  try {
    const value = await doFetch(bust ? BUST_TIMEOUT_MS : RELAY_TIMEOUT_MS);
    return makeResponse(value, "miss");
  } catch (error) {
    // Relay timeout: fall back to stale if any cached value exists, even past stale window
    if (cached && (error as Error).message === "relay_timeout") {
      return makeResponse(cached.value, "stale");
    }
    return jsonWithCorrelation(
      { error: error instanceof Error ? error.message : "Failed to load remote agent overview" },
      { status: 504 },
      correlationId,
    );
  }
}

function stripLogs(overview: RemoteApprovalOverview): RemoteApprovalOverview {
  return {
    ...overview,
    jobs: overview.jobs.map(({ logTail: _, ...job }) => job),
  };
}
