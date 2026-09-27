import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, futureDate, setup, signToken, teardown, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => { f = await setup(); }, 60_000);
afterAll(teardown, 60_000);

const route = "/user/booking/search-by-tests";

describe("userAuthMiddleware", () => {
  test("rejects a request with no Authorization header", async () => {
    const r = await call(route, { testname: "x" });
    expect(r.status).toBe(401);
  });

  test("rejects a token without the Bearer prefix", async () => {
    const r = await call(route, { testname: "x" }, f.userToken.replace("Bearer ", ""));
    expect(r.status).toBe(401);
  });

  test("rejects an empty Bearer token", async () => {
    const r = await call(route, { testname: "x" }, "Bearer ");
    expect(r.status).toBe(401);
  });

  test("rejects a garbage token", async () => {
    const r = await call(route, { testname: "x" }, "Bearer abc.def.ghi");
    expect(r.status).toBe(401);
  });

  test("rejects an expired token", async () => {
    const token = signToken(f.userId, process.env.ACCESS_TOKEN_SECRET!, -10);
    const r = await call(route, { testname: "x" }, `Bearer ${token}`);
    expect(r.status).toBe(401);
  });

  test("rejects a token signed with the refresh secret", async () => {
    const token = signToken(f.userId, process.env.REFRESH_TOKEN_SECRET!);
    const r = await call(route, { testname: "x" }, `Bearer ${token}`);
    expect(r.status).toBe(401);
  });

  test("rejects a hospital access token on a user route", async () => {
    const r = await call(route, { testname: "x" }, f.hospitalToken);
    expect(r.status).toBe(401);
  });

  test("a hospital token cannot book a test as a user", async () => {
    const r = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.hospitalToken);
    expect(r.status).toBe(401);
  });

  test("rejects a valid token for a user that does not exist (401, not 500)", async () => {
    const token = signToken("00000000-0000-0000-0000-000000000000", process.env.ACCESS_TOKEN_SECRET!);
    const r = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, `Bearer ${token}`);
    expect(r.status).toBe(401);
  });

  test("accepts a valid user token", async () => {
    const r = await call(route, { testname: "x" }, f.userToken);
    expect(r.status).not.toBe(401);
  });
});
