import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { call, createExtraTest, futureDate, get, prisma, setup, teardown, type Fixture } from "./helpers";

let f: Fixture;
let extraTestId: string;
beforeAll(async () => {
  f = await setup();
  extraTestId = (await createExtraTest(f)).id;
}, 60_000);
afterEach(async () => {
  const userId = { in: [f.userId, f.user2Id] };
  await prisma.payment.deleteMany({ where: { booking: { userId } } });
  await prisma.booking.deleteMany({ where: { userId } });
}, 30_000);
afterAll(teardown, 60_000);

const newBooking = async (token = f.userToken, testid = f.testId): Promise<string> => {
  const r = await call("/user/booking/booking", { testid, date: futureDate() }, token);
  if (r.status !== 201) throw new Error(`booking setup failed: ${JSON.stringify(r)}`);
  return r.json.booking.id;
};
const pay = (bookingId: string, key: string = randomUUID(), token = f.userToken, body: object = {}) =>
  call("/payments", { bookingId, ...body }, token, undefined, { "Idempotency-Key": key });

describe("POST /payments", () => {
  test("starts a payment: 202, Created, amount from the booking, booking still Pending", async () => {
    const bookingId = await newBooking();
    const r = await pay(bookingId);
    expect(r.status).toBe(202);
    expect(r.json.payment).toMatchObject({ bookingId, status: "Created", amount: 500, failureReason: null });
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(booking!.status).toBe("Pending");
  });

  test("stores a mock providerRef but does not return it", async () => {
    const r = await pay(await newBooking());
    expect(r.json.payment.providerRef).toBeUndefined();
    const stored = await prisma.payment.findUnique({ where: { id: r.json.payment.id } });
    expect(stored!.providerRef).toStartWith("mock_pay_");
  });

  test("ignores an amount sent in the body", async () => {
    const r = await pay(await newBooking(), randomUUID(), f.userToken, { amount: 1, price: 1 });
    expect(r.status).toBe(202);
    expect(r.json.payment.amount).toBe(500);
  });

  test("replaying the same Idempotency-Key returns the same payment with 200", async () => {
    const bookingId = await newBooking();
    const key = randomUUID();
    const first = await pay(bookingId, key);
    const second = await pay(bookingId, key);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.json.payment.id).toBe(first.json.payment.id);
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(1);
  });

  test("replay still works after the booking is Confirmed", async () => {
    const bookingId = await newBooking();
    const key = randomUUID();
    const first = await pay(bookingId, key);
    await prisma.booking.update({ where: { id: bookingId }, data: { status: "Confirmed" } });
    const r = await pay(bookingId, key);
    expect(r.status).toBe(200);
    expect(r.json.payment.id).toBe(first.json.payment.id);
  });

  test("reusing a key for a different booking returns 422", async () => {
    const key = randomUUID();
    expect((await pay(await newBooking(), key)).status).toBe(202);
    const r = await pay(await newBooking(f.userToken, extraTestId), key);
    expect(r.status).toBe(422);
  });

  test("a new key on a booking that already has a payment returns 409", async () => {
    const bookingId = await newBooking();
    expect((await pay(bookingId)).status).toBe(202);
    const r = await pay(bookingId);
    expect(r.status).toBe(409);
  });

  test.each(["Confirmed", "Failed", "Cancelled"] as const)("returns 409 when the booking is %s", async (status) => {
    const bookingId = await newBooking();
    await prisma.booking.update({ where: { id: bookingId }, data: { status } });
    const r = await pay(bookingId);
    expect(r.status).toBe(409);
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(0);
  });

  test("returns 404 for another user's booking", async () => {
    const bookingId = await newBooking();
    const r = await pay(bookingId, randomUUID(), f.user2Token);
    expect(r.status).toBe(404);
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(0);
  });

  test("returns 404 for an unknown booking", async () => {
    const r = await pay(randomUUID());
    expect(r.status).toBe(404);
  });

  test("concurrent requests with different keys create only one payment", async () => {
    const bookingId = await newBooking();
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(bookingId)));
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(1);
  });

  test("concurrent requests with the same key create one payment and replay it", async () => {
    const bookingId = await newBooking();
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 3 }, () => pay(bookingId, key)));
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(new Set(results.map((r) => r.json.payment.id)).size).toBe(1);
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(1);
  });

  test("returns 401 without a token", async () => {
    const r = await call("/payments", { bookingId: randomUUID() }, undefined, undefined, { "Idempotency-Key": randomUUID() });
    expect(r.status).toBe(401);
  });

  test.each([
    ["missing Idempotency-Key", {}, undefined],
    ["non-uuid Idempotency-Key", {}, "abc"],
    ["missing bookingId", { bookingId: undefined }, randomUUID()],
    ["non-uuid bookingId", { bookingId: "abc" }, randomUUID()],
    ["invalid simulate value", { simulate: "maybe" }, randomUUID()],
  ])("returns 400 for %s", async (_name, override, key) => {
    const bookingId = await newBooking();
    const headers: Record<string, string> = key ? { "Idempotency-Key": key } : {};
    const r = await call("/payments", { bookingId, ...override }, f.userToken, undefined, headers);
    expect(r.status).toBe(400);
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(0);
  });
});

describe("GET /payments/:id", () => {
  test("returns the caller's payment with its booking status", async () => {
    const bookingId = await newBooking();
    const created = await pay(bookingId);
    const r = await get(`/payments/${created.json.payment.id}`, f.userToken);
    expect(r.status).toBe(200);
    expect(r.json.payment).toMatchObject({ id: created.json.payment.id, status: "Created", booking: { id: bookingId, status: "Pending" } });
  });

  test("returns 404 for another user's payment", async () => {
    const created = await pay(await newBooking());
    const r = await get(`/payments/${created.json.payment.id}`, f.user2Token);
    expect(r.status).toBe(404);
  });

  test("returns 404 for an unknown payment", async () => {
    const r = await get(`/payments/${randomUUID()}`, f.userToken);
    expect(r.status).toBe(404);
  });

  test("returns 400 for a non-uuid id", async () => {
    const r = await get("/payments/abc", f.userToken);
    expect(r.status).toBe(400);
  });

  test("returns 401 without a token", async () => {
    const r = await get(`/payments/${randomUUID()}`);
    expect(r.status).toBe(401);
  });
});
