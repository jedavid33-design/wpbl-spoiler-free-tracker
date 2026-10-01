// WPBL stats API CORS proxy for the WPBL Spoiler-Free Tracker.
//
// SECURITY MODEL: strict allowlist, default-deny. This proxy exists only to
// serve the tracker's GitHub Pages frontend, which fetches exactly two
// endpoints:
//
//   GET /games                      schedule picker (worker injects limit=100 when absent)
//   GET /games/<gameId>/boxscore    play-by-play for one game
//
// Anything else — any other path, any other query parameter, any other
// method — gets a 404/405 and is never forwarded upstream. No auth is
// needed because only these two read-only public-stats endpoints exist;
// an in-memory per-IP rate limit keeps casual abuse from burning the
// 100k requests/day free-tier allowance.

const WPBL_API_BASE = "https://stats.womensprobaseballleague.com/v1";

// gameId values from the upstream API are alphanumeric. Allow alphanumerics
// plus dash/underscore so legitimate ids pass while path-traversal and
// query-injection shapes can never reach the upstream URL.
const GAME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Rate limit: generous for real use (the frontend makes 1 request at startup
// and ~4/min while tracking a live game), tight enough to make the proxy
// useless as an anonymous high-volume fetch endpoint.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const recentRequestsByIp = new Map();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

function isRateLimited(request) {
  const ip = clientIp(request);
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  let timestamps = recentRequestsByIp.get(ip);
  if (!timestamps) {
    timestamps = [];
    recentRequestsByIp.set(ip, timestamps);
  }
  while (timestamps.length > 0 && timestamps[0] <= windowStart) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  timestamps.push(now);
  return false;
}

// Returns the upstream URL path+query to fetch, or null when the request
// is not on the allowlist and must be denied.
function allowedUpstreamPath(requestUrl) {
  const pathname = requestUrl.pathname;
  const params = requestUrl.searchParams;

  if (pathname === "/games") {
    // Only `limit` is a permitted query parameter; anything else is denied.
    const paramNames = [...params.keys()];
    if (paramNames.some(name => name !== "limit")) {
      return null;
    }
    let limit = "100";
    if (params.has("limit")) {
      const raw = params.get("limit");
      if (!/^\d+$/.test(raw)) {
        return null;
      }
      limit = String(Math.min(Math.max(Number(raw), 1), 100));
    }
    return `/games?limit=${limit}`;
  }

  const boxscoreMatch = pathname.match(/^\/games\/([^/]+)\/boxscore$/);
  if (boxscoreMatch) {
    const gameId = boxscoreMatch[1];
    if (!GAME_ID_PATTERN.test(gameId)) {
      return null;
    }
    // The frontend never sends query parameters on boxscore fetches.
    if ([...params.keys()].length > 0) {
      return null;
    }
    return `/games/${encodeURIComponent(gameId)}/boxscore`;
  }

  return null;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return jsonResponse(405, { error: "method not allowed" });
    }

    if (isRateLimited(request)) {
      return jsonResponse(429, { error: "rate limit exceeded" });
    }

    const requestUrl = new URL(request.url);
    const upstreamPath = allowedUpstreamPath(requestUrl);
    if (!upstreamPath) {
      return jsonResponse(404, { error: "not found" });
    }

    try {
      const response = await fetch(WPBL_API_BASE + upstreamPath, {
        headers: { "Accept": "application/json" }
      });

      const body = await response.text();

      return new Response(body, {
        status: response.status,
        headers: {
          ...CORS_HEADERS,
          "Content-Type":
            response.headers.get("Content-Type") || "application/json"
        }
      });
    } catch (error) {
      // Generic message only: never leak fetch/DNS internals to callers.
      return jsonResponse(500, { error: "WPBL proxy error" });
    }
  }
};
