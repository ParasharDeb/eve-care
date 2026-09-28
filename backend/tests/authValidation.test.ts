import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { call, prisma, serverOrigin, setup, teardown } from "./helpers";

beforeAll(async () => { await setup(); }, 60_000);
afterAll(teardown, 60_000);

const email = () => `badinput${Date.now()}${Math.floor(Math.random() * 1e4)}@test.com`;

describe("signup validation", () => {
  test.each([
    ["an email without @", { username: "a", email: "not-an-email", password: "Passw0rd!" }],
    ["an email without a domain", { username: "a", email: "a@", password: "Passw0rd!" }],
    ["an empty email", { username: "a", email: "", password: "Passw0rd!" }],
    ["a password under 8 characters", { username: "a", email: email(), password: "short" }],
    ["an empty username", { username: "", email: email(), password: "Passw0rd!" }],
    ["a whitespace-only username", { username: "   ", email: email(), password: "Passw0rd!" }],
    ["a missing password", { username: "a", email: email() }],
  ])("user signup rejects %s with 400", async (_name, body) => {
    const r = await call("/user/auth/signup", body);
    expect(r.status).toBe(400);
  });

  test("a rejected user signup creates nothing", async () => {
    const bad = email();
    await call("/user/auth/signup", { username: "a", email: bad, password: "short" });
    expect(await prisma.user.findUnique({ where: { email: bad } })).toBeNull();
  });

  test.each([
    ["an invalid email", { hospitalname: "X", email: "nope", password: "Passw0rd!", location: "City" }],
    ["a password under 8 characters", { hospitalname: "X", email: email(), password: "short", location: "City" }],
    ["an empty location", { hospitalname: "X", email: email(), password: "Passw0rd!", location: "" }],
    ["a whitespace-only name", { hospitalname: "  ", email: email(), password: "Passw0rd!", location: "City" }],
  ])("hospital signup rejects %s with 400", async (_name, body) => {
    const r = await call("/hospital/auth/signup", body);
    expect(r.status).toBe(400);
  });
});

describe("signin validation", () => {
  test("user signin rejects an invalid email with 400, before looking anything up", async () => {
    const r = await call("/user/auth/signin", { email: "not-an-email", password: "whatever" });
    expect(r.status).toBe(400);
  });

  test("hospital signin rejects an empty password with 400", async () => {
    const r = await call("/hospital/auth/signin", { email: email(), password: "" });
    expect(r.status).toBe(400);
  });

  test("a short but wrong password is still a 401, not a 400", async () => {
    const r = await call("/user/auth/signin", { email: email(), password: "x" });
    expect(r.status).toBe(401);
  });
});

describe("api docs", () => {
  test("serves the OpenAPI spec as JSON", async () => {
    const res = await fetch(`${serverOrigin()}/docs/openapi.json`);
    const spec: any = await res.json();
    expect(res.status).toBe(200);
    expect(spec.openapi).toBe("3.0.3");
    expect(Object.keys(spec.paths)).toContain("/payments/webhook");
  });

  test("serves swagger ui at /docs", async () => {
    const res = await fetch(`${serverOrigin()}/docs/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("swagger-ui");
  });
});
