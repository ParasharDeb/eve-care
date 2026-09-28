import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "crypto";
import { call, futureDate, get, prisma, setup, teardown, type Fixture } from "./helpers";

// the route reads the secret per request, so setting it here is enough
const SECRET = "test-webhook-secret";
process.env.WEBHOOK_SECRET = SECRET;

let f: Fixture;
const eventPrefix = `evt_${randomUUID().slice(0, 8)}_`;
beforeAll(async () => { f = await setup(); }, 60_000);
afterEach(async () => {
  await prisma.webhook.deleteMany({ where: { eventID: { startsWith: eventPrefix } } });
  await prisma.payment.deleteMany({ where: { booking: { userId: f.userId } } });
  await prisma.booking.deleteMany({ where: { userId: f.userId } });
}, 30_000);
afterAll(teardown, 60_000);

const newEventId = () => eventPrefix + randomUUID();

// a Pending booking with a Created payment, like right after POST /payments
async function startPayment() {
  const booking = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.userToken);
  const paid = await call("/payments", { bookingId: booking.json.booking.id }, f.userToken, undefined, { "Idempotency-Key": randomUUID() });
  const payment = await prisma.payment.findUnique({ where: { id: paid.json.payment.id } });
  return { bookingId: booking.json.booking.id as string, paymentId: payment!.id, providerRef: payment!.providerRef! };
}

function sendWebhook(event: object, signature?: string) {
  const raw = JSON.stringify(event);
  const sig = signature ?? createHmac("sha256", SECRET).update(raw).digest("hex");
  return call("/payments/webhook", undefined, undefined, raw, { "X-Webhook-Signature": sig });
}

const state = async (p: { paymentId: string; bookingId: string }) => ({
  payment: await prisma.payment.findUnique({ where: { id: p.paymentId } }),
  booking: await prisma.booking.findUnique({ where: { id: p.bookingId } }),
});

describe("POST /payments/webhook", () => {
  test("SUCCESS settles the payment and confirms the booking", async () => {
    const p = await startPayment();
    const r = await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" });
    expect(r.status).toBe(200);
    const s = await state(p);
    expect(s.payment!.status).toBe("Success");
    expect(s.booking!.status).toBe("Confirmed");
  });

  test("FAILED fails the payment and the booking and stores the reason", async () => {
    const p = await startPayment();
    const r = await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "FAILED", failureReason: "card_declined" });
    expect(r.status).toBe(200);
    const s = await state(p);
    expect(s.payment).toMatchObject({ status: "Failed", failureReason: "card_declined" });
    expect(s.booking!.status).toBe("Failed");
  });

  test("FAILED without a reason stores a default one", async () => {
    const p = await startPayment();
    await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "FAILED" });
    expect((await state(p)).payment!.failureReason).toBe("payment_failed");
  });

  test("the same event sent 3 times is applied once", async () => {
    const p = await startPayment();
    const event = { eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" };
    const results = [await sendWebhook(event), await sendWebhook(event), await sendWebhook(event)];
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results[1]!.json.message).toBe("event already processed");
    expect(await prisma.webhook.count({ where: { eventID: event.eventId } })).toBe(1);
    expect((await state(p)).booking!.status).toBe("Confirmed");
  });

  test("the same event sent concurrently is applied once", async () => {
    const p = await startPayment();
    const event = { eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" };
    const results = await Promise.all([sendWebhook(event), sendWebhook(event), sendWebhook(event)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.webhook.count({ where: { eventID: event.eventId } })).toBe(1);
    expect((await state(p)).payment!.status).toBe("Success");
  });

  test("a FAILED event after SUCCESS is recorded but changes nothing", async () => {
    const p = await startPayment();
    await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" });
    const lateId = newEventId();
    const r = await sendWebhook({ eventId: lateId, providerRef: p.providerRef, status: "FAILED" });
    expect(r.status).toBe(200);
    expect(r.json.message).toBe("payment already settled, event ignored");
    const s = await state(p);
    expect(s.payment!.status).toBe("Success");
    expect(s.booking!.status).toBe("Confirmed");
    expect((await prisma.webhook.findUnique({ where: { eventID: lateId } }))!.status).toBe("ignored");
  });

  test("SUCCESS for a booking cancelled while paying refunds the payment", async () => {
    const p = await startPayment();
    await prisma.booking.update({ where: { id: p.bookingId }, data: { status: "Cancelled" } });
    const r = await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" });
    expect(r.status).toBe(200);
    expect(r.json.message).toBe("booking was cancelled, payment refunded");
    const s = await state(p);
    expect(s.payment!.status).toBe("Refunded");
    expect(s.booking!.status).toBe("Cancelled");
  });

  test("FAILED for a booking cancelled while paying just fails the payment", async () => {
    const p = await startPayment();
    await prisma.booking.update({ where: { id: p.bookingId }, data: { status: "Cancelled" } });
    await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "FAILED" });
    const s = await state(p);
    expect(s.payment!.status).toBe("Failed");
    expect(s.booking!.status).toBe("Cancelled");
  });

  test("GET /payments/:id shows the settled status", async () => {
    const p = await startPayment();
    await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" });
    const r = await get(`/payments/${p.paymentId}`, f.userToken);
    expect(r.json.payment).toMatchObject({ status: "Success", booking: { status: "Confirmed" } });
  });

  test("returns 404 for an unknown providerRef and records nothing", async () => {
    const eventId = newEventId();
    const r = await sendWebhook({ eventId, providerRef: "mock_pay_unknown", status: "SUCCESS" });
    expect(r.status).toBe(404);
    expect(await prisma.webhook.count({ where: { eventID: eventId } })).toBe(0);
  });

  test.each([
    ["a missing signature", ""],
    ["a wrong signature", "0".repeat(64)],
    ["a signature of different length", "abc"],
  ])("returns 401 for %s and changes nothing", async (_name, signature) => {
    const p = await startPayment();
    const r = await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" }, signature);
    expect(r.status).toBe(401);
    expect((await state(p)).payment!.status).toBe("Created");
  });

  test("returns 401 when the body was changed after signing", async () => {
    const p = await startPayment();
    const signed = JSON.stringify({ eventId: newEventId(), providerRef: p.providerRef, status: "FAILED" });
    const sig = createHmac("sha256", SECRET).update(signed).digest("hex");
    const r = await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" }, sig);
    expect(r.status).toBe(401);
    expect((await state(p)).payment!.status).toBe("Created");
  });

  test.each([
    ["missing eventId", { providerRef: "mock_pay_x", status: "SUCCESS" }],
    ["missing providerRef", { eventId: "evt", status: "SUCCESS" }],
    ["unknown status", { eventId: "evt", providerRef: "mock_pay_x", status: "PENDING" }],
  ])("returns 400 for %s", async (_name, body) => {
    const r = await sendWebhook(body);
    expect(r.status).toBe(400);
  });
});

describe("POST /booking/:id/cancel", () => {
  const cancel = (bookingId: string, token = f.userToken) => call(`/user/booking/booking/${bookingId}/cancel`, {}, token);

  test("cancels a Pending booking with no payment, nothing to refund", async () => {
    const booking = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.userToken);
    const r = await cancel(booking.json.booking.id);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: "Cancelled", refunded: false });
    expect((await prisma.booking.findUnique({ where: { id: booking.json.booking.id } }))!.status).toBe("Cancelled");
  });

  test("cancels a Confirmed booking and refunds its payment", async () => {
    const p = await startPayment();
    await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" });
    const r = await cancel(p.bookingId);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: "Cancelled", refunded: true });
    const s = await state(p);
    expect(s.booking!.status).toBe("Cancelled");
    expect(s.payment!.status).toBe("Refunded");
  });

  test("cancel while paying, then SUCCESS arrives: payment is refunded", async () => {
    const p = await startPayment();
    const r = await cancel(p.bookingId);
    expect(r.json.refunded).toBe(false);
    await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" });
    const s = await state(p);
    expect(s.booking!.status).toBe("Cancelled");
    expect(s.payment!.status).toBe("Refunded");
  });

  test("a cancelled booking can't be paid", async () => {
    const booking = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.userToken);
    await cancel(booking.json.booking.id);
    const r = await call("/payments", { bookingId: booking.json.booking.id }, f.userToken, undefined, { "Idempotency-Key": randomUUID() });
    expect(r.status).toBe(409);
  });

  test("the test can be booked again after cancelling", async () => {
    const booking = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.userToken);
    await cancel(booking.json.booking.id);
    const again = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.userToken);
    expect(again.status).toBe(201);
  });

  test.each(["Cancelled", "Failed"] as const)("returns 409 for a %s booking", async (status) => {
    const booking = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.userToken);
    await prisma.booking.update({ where: { id: booking.json.booking.id }, data: { status } });
    expect((await cancel(booking.json.booking.id)).status).toBe(409);
  });

  test("a refunded payment is not refunded twice", async () => {
    const p = await startPayment();
    await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" });
    await cancel(p.bookingId);
    const r = await cancel(p.bookingId);
    expect(r.status).toBe(409);
    expect((await state(p)).payment!.status).toBe("Refunded");
  });

  test("returns 404 for another user's booking", async () => {
    const booking = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.userToken);
    expect((await cancel(booking.json.booking.id, f.user2Token)).status).toBe(404);
    expect((await prisma.booking.findUnique({ where: { id: booking.json.booking.id } }))!.status).toBe("Pending");
  });

  test("returns 404 for an unknown booking and 400 for a bad id", async () => {
    expect((await cancel(randomUUID())).status).toBe(404);
    expect((await cancel("abc")).status).toBe(400);
  });

  test("returns 401 without a token", async () => {
    const r = await call(`/user/booking/booking/${randomUUID()}/cancel`, {});
    expect(r.status).toBe(401);
  });
});
