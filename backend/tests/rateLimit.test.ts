import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { call, get, serverOrigin, setup, teardown, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => {
  f = await setup(); // sign up / sign in before the limits are on
  process.env.RATE_LIMIT_DISABLED = "false";
}, 60_000);
afterAll(async () => {
  process.env.RATE_LIMIT_DISABLED = "true";
  await teardown();
}, 60_000);

// limits are per IP and every request here comes from localhost, so the tests share counters.
// they run in order: auth (10), payments (20), then the general /api limit (100).
describe("rate limiting", () => {
  test("signin allows 10 attempts per 15 minutes, then 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await call("/user/auth/signin", { email: `nobody${i}@x.test`, password: "wrong" });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  test("the auth limit is shared by user and hospital signin", async () => {
    const r = await call("/hospital/auth/signin", { email: "nobody@x.test", password: "wrong" });
    expect(r.status).toBe(429);
    expect(r.json.message).toBe("too many attempts, try again in 15 minutes");
  });

  test("POST /payments allows 20 requests per minute, then 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      // no Idempotency-Key: rejected with 400 by the handler, but still counted by the limiter
      const r = await call("/payments", { bookingId: randomUUID() }, f.userToken);
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  test("the webhook is never rate limited", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        call("/payments/webhook", undefined, undefined, "{}", { "X-Webhook-Signature": "bad" }),
      ),
    );
    // rejected for the bad signature, never throttled
    expect(results.every((r) => r.status === 401)).toBe(true);
  });

  test("every /api route is limited to 100 requests per minute", async () => {
    let first429 = -1;
    for (let i = 0; i < 101; i++) {
      const r = await get("/user/booking/bookings"); // no token: 401 without touching the database
      if (r.status === 429) {
        first429 = i;
        expect(r.json.message).toBe("too many requests, slow down");
        break;
      }
    }
    // the 11 signin attempts above also counted toward this limit
    expect(first429).toBeGreaterThan(0);
  });

  test("429 responses tell the client the limit and when to retry", async () => {
    const res = await fetch(`${serverOrigin()}/api/user/booking/bookings`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(res.headers.get("ratelimit-policy")).toContain("q=100");
  });
});
