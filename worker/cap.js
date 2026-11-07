// Daily debate cap. Counting logic is a pure function; the Durable Object only persists it.
export const DEFAULT_LIMIT = 20;

export function parseLimit(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
}

export function utcDate(d) {
  return d.toISOString().slice(0, 10);
}

// state: {date,count} | null | undefined. Returns {allowed, state}. Blocked hits are not counted.
export function applyCap(state, date, limit) {
  const count = state && state.date === date ? state.count : 0;
  if (count + 1 > limit) return { allowed: false, state: { date, count } };
  return { allowed: true, state: { date, count: count + 1 } };
}

// SQLite-backed Durable Object (see wrangler.jsonc new_sqlite_classes). A DO processes one
// request at a time and storage writes are atomic, so read-modify-write is race free.
export class DailyCap {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const date = url.searchParams.get("date") || utcDate(new Date());
    const prev = await this.ctx.storage.get("state");
    const { allowed, state } = applyCap(prev, date, limit);
    if (allowed) await this.ctx.storage.put("state", state);
    return Response.json({ allowed, count: state.count, limit });
  }
}
