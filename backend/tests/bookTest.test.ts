import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { call, createExtraTest, futureDate, get, prisma, setup, teardown, type Fixture } from "./helpers";

let f: Fixture;
let extraTestId: string;
beforeAll(async () => {
  f = await setup();
  extraTestId = (await createExtraTest(f)).id;
}, 60_000);
afterEach(async () => { await prisma.booking.deleteMany({ where: { userId: { in: [f.userId, f.user2Id] } } }); }, 30_000);
afterAll(teardown, 60_000);

const route = "/user/booking/booking";
const valid = () => ({ testid: f.testId, date: futureDate() });
const book = (token = f.userToken, body: object = valid()) => call(route, body, token);

describe("POST /booking", () => {
  test("creates a Pending booking with the price copied from the test", async () => {
    const r = await book();
    expect(r.status).toBe(201);
    expect(r.json.booking).toMatchObject({ userId: f.userId, testId: f.testId, status: "Pending", price: 500 });
  });

  test("ignores a price sent in the body", async () => {
    const r = await book(f.userToken, { ...valid(), price: 1 });
    expect(r.status).toBe(201);
    expect(r.json.booking.price).toBe(500);
  });

  test("uses the user id from the token, not from the body", async () => {
    const r = await book(f.userToken, { ...valid(), userId: f.user2Id });
    expect(r.status).toBe(201);
    expect(r.json.booking.userId).toBe(f.userId);
  });

  test("stores the appointment date and time", async () => {
    const body = valid();
    const r = await book(f.userToken, body);
    expect(r.json.booking.date).toBe(body.date);
  });

  test("accepts a timestamp with a timezone offset", async () => {
    const r = await book(f.userToken, { ...valid(), date: "2099-01-01T10:30:00+05:30" });
    expect(r.status).toBe(201);
    expect(r.json.booking.date).toBe("2099-01-01T05:00:00.000Z");
  });

  test("returns 409 for a duplicate active booking", async () => {
    expect((await book()).status).toBe(201);
    const r = await book();
    expect(r.status).toBe(409);
  });

  test.each(["Cancelled", "Failed"] as const)("allows rebooking after the previous booking is %s", async (status) => {
    const first = await book();
    await prisma.booking.update({ where: { id: first.json.booking.id }, data: { status } });
    const r = await book();
    expect(r.status).toBe(201);
  });

  test("the same user can book a different test", async () => {
    expect((await book()).status).toBe(201);
    const r = await book(f.userToken, { ...valid(), testid: extraTestId });
    expect(r.status).toBe(201);
  });

  test("a different user can book the same test", async () => {
    expect((await book()).status).toBe(201);
    const r = await book(f.user2Token);
    expect(r.status).toBe(201);
  });

  test("concurrent duplicate requests create only one booking", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => book(f.user2Token)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.booking.count({ where: { userId: f.user2Id } })).toBe(1);
  });

  test("returns 404 for an unknown test id", async () => {
    const r = await book(f.userToken, { ...valid(), testid: randomUUID() });
    expect(r.status).toBe(404);
  });

  test("returns 401 without a token", async () => {
    const r = await call(route, valid());
    expect(r.status).toBe(401);
  });

  test.each([
    ["missing testid", { testid: undefined }],
    ["empty testid", { testid: "" }],
    ["non-uuid testid", { testid: "abc" }],
    ["missing date", { date: undefined }],
    ["invalid date", { date: "not-a-date" }],
    ["date without a time", { date: "2099-01-01" }],
    ["past date", { date: "2020-01-01T00:00:00.000Z" }],
    ["date equal to now", { date: new Date().toISOString() }],
  ])("returns 400 for %s", async (_name, override) => {
    const r = await book(f.userToken, { ...valid(), ...override });
    expect(r.status).toBe(400);
    expect(await prisma.booking.count({ where: { userId: f.userId } })).toBe(0);
  });
});

describe("GET /booking/:id", () => {
  test("returns the caller's booking with test, hospital and payment", async () => {
    const created = await book();
    const r = await get(`/user/booking/booking/${created.json.booking.id}`, f.userToken);
    expect(r.status).toBe(200);
    expect(r.json.booking).toMatchObject({ id: created.json.booking.id, status: "Pending", payments: null });
    expect(r.json.booking.test).toMatchObject({ id: f.testId, hospital: { id: f.hospitalId } });
  });

  test("returns 404 for another user's booking", async () => {
    const created = await book();
    const r = await get(`/user/booking/booking/${created.json.booking.id}`, f.user2Token);
    expect(r.status).toBe(404);
  });

  test("returns 404 for an unknown booking id", async () => {
    const r = await get(`/user/booking/booking/${randomUUID()}`, f.userToken);
    expect(r.status).toBe(404);
  });

  test("returns 400 for a non-uuid booking id", async () => {
    const r = await get("/user/booking/booking/abc", f.userToken);
    expect(r.status).toBe(400);
  });

  test("returns 401 without a token", async () => {
    const r = await get(`/user/booking/booking/${randomUUID()}`);
    expect(r.status).toBe(401);
  });
});

describe("GET /bookings", () => {
  test("returns an empty list when the user has no bookings", async () => {
    const r = await get("/user/booking/bookings", f.userToken);
    expect(r.status).toBe(200);
    expect(r.json.bookings).toEqual([]);
  });

  test("returns only the caller's bookings, newest first", async () => {
    await book(f.user2Token);
    const older = await book();
    await prisma.booking.update({ where: { id: older.json.booking.id }, data: { status: "Cancelled" } });
    const newer = await book();

    const r = await get("/user/booking/bookings", f.userToken);
    expect(r.status).toBe(200);
    expect(r.json.bookings.map((b: { id: string }) => b.id)).toEqual([newer.json.booking.id, older.json.booking.id]);
    expect(r.json.bookings.every((b: { userId: string }) => b.userId === f.userId)).toBe(true);
  });

  test("returns 401 without a token", async () => {
    const r = await get("/user/booking/bookings");
    expect(r.status).toBe(401);
  });
});
