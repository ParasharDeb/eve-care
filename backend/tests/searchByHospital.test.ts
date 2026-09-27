import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, setup, teardown, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => { f = await setup(); }, 60_000);
afterAll(teardown, 60_000);

const route = "/user/booking/search-by-hospital";

describe("POST /search-by-hospital", () => {
  test("returns the hospital's tests for an exact name", async () => {
    const r = await call(route, { hospital: f.hospitalName }, f.userToken);
    expect(r.status).toBe(200);
    expect(r.json.tests).toHaveLength(1);
    expect(r.json.tests[0].id).toBe(f.testId);
  });

  test("matches case-insensitively", async () => {
    const r = await call(route, { hospital: f.hospitalName.toUpperCase() }, f.userToken);
    expect(r.status).toBe(200);
  });

  test("trims surrounding whitespace", async () => {
    const r = await call(route, { hospital: `  ${f.hospitalName}  ` }, f.userToken);
    expect(r.status).toBe(200);
  });

  test("finds a hospital by partial name", async () => {
    const r = await call(route, { hospital: f.hospitalName.slice(0, -3) }, f.userToken);
    expect(r.status).toBe(200);
  });

  test("returns 404 for an unknown hospital", async () => {
    const r = await call(route, { hospital: "zzz-no-such-hospital" }, f.userToken);
    expect(r.status).toBe(404);
  });

  test.each([
    ["missing field", {}],
    ["empty string", { hospital: "" }],
    ["whitespace only", { hospital: "   " }],
    ["non-string", { hospital: 5 }],
  ])("returns 400 for %s", async (_name, body) => {
    const r = await call(route, body, f.userToken);
    expect(r.status).toBe(400);
  });

  test("returns 400 for malformed JSON", async () => {
    const r = await call(route, undefined, f.userToken, "{bad json");
    expect(r.status).toBe(400);
  });

  test("returns 400 for an empty body", async () => {
    const r = await call(route, undefined, f.userToken, "");
    expect(r.status).toBe(400);
  });
});
