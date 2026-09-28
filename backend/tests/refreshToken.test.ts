import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { call, prisma, serverOrigin, setup, teardown } from "./helpers";
import { hashToken } from "../src/utils/tokens";
import { checkEnv } from "../src/utils/env";

beforeAll(async () => { await setup(); }, 60_000);
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: "refresh-" } } });
  await prisma.hospital.deleteMany({ where: { email: { startsWith: "refresh-" } } });
  await teardown();
}, 60_000);

const password = "Passw0rd!";
const userCookie = process.env.USER_REFRESH_COOKIE!;
const hospitalCookie = process.env.REFRESH_COOKIE!;

// the helpers don't handle cookies, so these send and read them by hand
async function post(path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie !== undefined) headers.Cookie = cookie;
  const res = await fetch(`${serverOrigin()}/api${path}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json, cookies: res.headers.getSetCookie() };
}

function cookieValue(setCookies: string[], name: string) {
  const c = setCookies.find((s) => s.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.slice(name.length + 1).split(";")[0]!) : undefined;
}

async function newUser() {
  const email = `refresh-${randomUUID()}@test.com`;
  const signup = await call("/user/auth/signup", { username: "r", email, password });
  return { email, id: signup.json.message as string };
}

async function signinUser(email: string) {
  const r = await post("/user/auth/signin", { email, password });
  return cookieValue(r.cookies, userCookie)!;
}

describe("user refresh token", () => {
  test("a user who never signed in has no refresh token stored (null, not a placeholder)", async () => {
    const { id } = await newUser();
    const user = await prisma.user.findUnique({ where: { id } });
    expect(user!.refreshtoken).toBeNull();
  });

  test("signin sets the cookie named in USER_REFRESH_COOKIE and stores only its hash", async () => {
    const { email, id } = await newUser();
    const token = await signinUser(email);
    expect(token).toBeDefined();
    const user = await prisma.user.findUnique({ where: { id } });
    expect(user!.refreshtoken).toBe(hashToken(token));
    expect(user!.refreshtoken).not.toBe(token);
  });

  test("refresh returns a new access token and rotates the refresh token", async () => {
    const { email } = await newUser();
    const first = await signinUser(email);
    const r = await post("/user/auth/refresh", undefined, `${userCookie}=${first}`);
    expect(r.status).toBe(200);
    expect(r.json.accessToken).toBeString();
    const second = cookieValue(r.cookies, userCookie);
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  test("an old refresh token stops working after a refresh, even within the same second", async () => {
    const { email } = await newUser();
    const first = await signinUser(email);
    await post("/user/auth/refresh", undefined, `${userCookie}=${first}`);
    const again = await post("/user/auth/refresh", undefined, `${userCookie}=${first}`);
    expect(again.status).toBe(401);
  });

  test("logout clears the stored token back to null and the cookie stops working", async () => {
    const { email, id } = await newUser();
    const token = await signinUser(email);
    const out = await post("/user/auth/logout", undefined, `${userCookie}=${token}`);
    expect(out.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id } }))!.refreshtoken).toBeNull();
    const r = await post("/user/auth/refresh", undefined, `${userCookie}=${token}`);
    expect(r.status).toBe(401);
  });

  test("refresh without the cookie is a 401", async () => {
    const r = await post("/user/auth/refresh");
    expect(r.status).toBe(401);
  });
});

describe("user and hospital refresh tokens are separate", () => {
  test("a user's refresh token is rejected by the hospital refresh route", async () => {
    const { email } = await newUser();
    const token = await signinUser(email);
    const r = await post("/hospital/auth/refresh", undefined, `${hospitalCookie}=${token}`);
    expect(r.status).toBe(401);
    expect(r.json.message).toBe("Invalid or expired refresh token");
  });

  test("a hospital's refresh token is rejected by the user refresh route", async () => {
    const email = `refresh-${randomUUID()}@test.com`;
    await call("/hospital/auth/signup", { hospitalname: `Refresh ${randomUUID()}`, email, password, location: "City" });
    const signin = await post("/hospital/auth/signin", { email, password });
    const token = cookieValue(signin.cookies, hospitalCookie)!;
    expect(token).toBeDefined();

    const asUser = await post("/user/auth/refresh", undefined, `${userCookie}=${token}`);
    expect(asUser.status).toBe(401);
    const asHospital = await post("/hospital/auth/refresh", undefined, `${hospitalCookie}=${token}`);
    expect(asHospital.status).toBe(200);
  });
});

describe("checkEnv", () => {
  const good = {
    DATABASE_URL: "postgresql://x",
    ACCESS_TOKEN_SECRET: "a",
    HOSPITAL_TOKEN_SECRET: "b",
    REFRESH_TOKEN_SECRET: "c",
    HOSPITAL_REFRESH_TOKEN_SECRET: "d",
    USER_REFRESH_COOKIE: "refreshToken",
    REFRESH_COOKIE: "hospitalRefreshToken",
    WEBHOOK_SECRET: "e",
  };

  test("passes when everything is set and different", () => {
    expect(checkEnv(good)).toEqual([]);
  });

  test("reports a missing or blank variable", () => {
    expect(checkEnv({ ...good, WEBHOOK_SECRET: undefined })).toEqual(["WEBHOOK_SECRET is not set"]);
    expect(checkEnv({ ...good, ACCESS_TOKEN_SECRET: "  " })).toContain("ACCESS_TOKEN_SECRET is not set");
  });

  test.each([
    ["ACCESS_TOKEN_SECRET", "HOSPITAL_TOKEN_SECRET"],
    ["REFRESH_TOKEN_SECRET", "HOSPITAL_REFRESH_TOKEN_SECRET"],
    ["USER_REFRESH_COOKIE", "REFRESH_COOKIE"],
  ])("reports %s equal to %s", (a, b) => {
    expect(checkEnv({ ...good, [b]: good[a as keyof typeof good] })).toEqual([`${a} and ${b} must be different`]);
  });

  test("the env the tests run with is valid", () => {
    expect(checkEnv()).toEqual([]);
  });
});
