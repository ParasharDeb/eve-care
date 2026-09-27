import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, setup, teardown, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => { f = await setup(); }, 60_000);
afterAll(teardown, 60_000);

const route = "/user/booking/search-by-tests";

describe("POST /search-by-tests", () => {
  test("returns matching tests with their hospital", async () => {
    const r = await call(route, { testname: f.testName }, f.userToken);
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0]).toMatchObject({ name: f.testName, price: 500, hospital: { id: f.hospitalId } });
  });

  test("matches case-insensitively", async () => {
    const r = await call(route, { testname: f.testName.toLowerCase() }, f.userToken);
    expect(r.status).toBe(200);
    expect(r.json.data).toHaveLength(1);
  });

  test("includes the test id so the frontend can book it", async () => {
    const r = await call(route, { testname: f.testName }, f.userToken);
    expect(r.json.data[0].id).toBe(f.testId);
  });

  test("finds a test by partial name", async () => {
    const r = await call(route, { testname: f.testName.slice(0, -3) }, f.userToken);
    expect(r.status).toBe(200);
    expect(r.json.data.some((t: { name: string }) => t.name === f.testName)).toBe(true);
  });

  test("returns 404 when nothing matches, like search-by-hospital", async () => {
    const r = await call(route, { testname: "zzz-no-such-test" }, f.userToken);
    expect(r.status).toBe(404);
  });

  test.each([
    ["missing field", {}],
    ["empty string", { testname: "" }],
    ["non-string", { testname: 5 }],
  ])("returns 400 for %s", async (_name, body) => {
    const r = await call(route, body, f.userToken);
    expect(r.status).toBe(400);
  });
});
