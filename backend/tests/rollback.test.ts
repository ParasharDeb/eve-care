import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "crypto";
import { call, futureDate, prisma, serverOrigin, setup, teardown, type Fixture } from "./helpers";
import { deliverWebhook } from "../src/utils/mockProvider";
import { retryOnConflict } from "../src/utils/retry";

const SECRET = "test-webhook-secret";
process.env.WEBHOOK_SECRET = SECRET;

let f: Fixture;
const eventPrefix = `evt_${randomUUID().slice(0, 8)}_`;
const cleanup: string[] = []; // SQL to undo triggers/sequences even if a test fails

beforeAll(async () => { f = await setup(); }, 60_000);
afterEach(async () => {
  while (cleanup.length) await prisma.$executeRawUnsafe(cleanup.pop()!);
  await prisma.webhook.deleteMany({ where: { eventID: { startsWith: eventPrefix } } });
  await prisma.payment.deleteMany({ where: { booking: { userId: f.userId } } });
  await prisma.booking.deleteMany({ where: { userId: f.userId } });
}, 30_000);
afterAll(teardown, 60_000);

const newEventId = () => eventPrefix + randomUUID();

async function startPayment() {
  const booking = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.userToken);
  const paid = await call("/payments", { bookingId: booking.json.booking.id }, f.userToken, undefined, { "Idempotency-Key": randomUUID() });
  const payment = await prisma.payment.findUnique({ where: { id: paid.json.payment.id } });
  return { bookingId: booking.json.booking.id as string, paymentId: payment!.id, providerRef: payment!.providerRef! };
}

function sendWebhook(event: object) {
  const raw = JSON.stringify(event);
  const sig = createHmac("sha256", SECRET).update(raw).digest("hex");
  return call("/payments/webhook", undefined, undefined, raw, { "X-Webhook-Signature": sig });
}

const state = async (p: { paymentId: string; bookingId: string }) => ({
  payment: await prisma.payment.findUnique({ where: { id: p.paymentId } }),
  booking: await prisma.booking.findUnique({ where: { id: p.bookingId } }),
});

// Simulates a crash half way through a transaction: a trigger that raises an error when one
// specific row of `table` is updated. With `failTimes`, it only fails the first N updates
// (a sequence counts them, and sequences are not rolled back with the transaction).
async function crashOnUpdate(table: "Booking" | "Payment", rowId: string, failTimes?: number) {
  const name = `test_crash_${randomUUID().replace(/-/g, "")}`;
  const condition = failTimes === undefined ? "TRUE" : `nextval('${name}') <= ${failTimes}`;
  if (failTimes !== undefined) {
    await prisma.$executeRawUnsafe(`CREATE SEQUENCE ${name}`);
    cleanup.unshift(`DROP SEQUENCE IF EXISTS ${name}`);
  }
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION ${name}() RETURNS trigger AS $$
    BEGIN
      IF NEW.id = '${rowId}' AND ${condition} THEN
        RAISE EXCEPTION 'simulated crash while updating ${table}';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  cleanup.push(`DROP FUNCTION IF EXISTS ${name}() CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  // dropping the function with CASCADE also drops the trigger
  return () => prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}() CASCADE`);
}

describe("rollback when the payment fails", () => {
  test("a FAILED payment fails the booking; the user can book and pay again", async () => {
    const p = await startPayment();
    await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "FAILED", failureReason: "card_declined" });

    const s = await state(p);
    expect(s.payment).toMatchObject({ status: "Failed", failureReason: "card_declined" });
    expect(s.booking!.status).toBe("Failed");

    // the failed booking can't be paid again...
    const retry = await call("/payments", { bookingId: p.bookingId }, f.userToken, undefined, { "Idempotency-Key": randomUUID() });
    expect(retry.status).toBe(409);
    // ...but the test is free to book again, and the new booking can be paid
    const again = await call("/user/booking/booking", { testid: f.testId, date: futureDate() }, f.userToken);
    expect(again.status).toBe(201);
    const pay = await call("/payments", { bookingId: again.json.booking.id }, f.userToken, undefined, { "Idempotency-Key": randomUUID() });
    expect(pay.status).toBe(202);
  });

  test.each(["FAILED", "SUCCESS"])("a crash half way through a %s webhook rolls everything back", async (status) => {
    const p = await startPayment();
    const eventId = newEventId();
    // the payment update succeeds, then the booking update crashes
    const stopCrashing = await crashOnUpdate("Booking", p.bookingId);

    const r = await sendWebhook({ eventId, providerRef: p.providerRef, status });
    expect(r.status).toBe(500);

    // nothing from the half-finished transaction survived
    const s = await state(p);
    expect(s.payment).toMatchObject({ status: "Created", failureReason: null });
    expect(s.booking!.status).toBe("Pending");
    // the event wasn't recorded either, so the provider's retry is processed instead of skipped as a duplicate
    expect(await prisma.webhook.count({ where: { eventID: eventId } })).toBe(0);

    await stopCrashing();
    const retried = await sendWebhook({ eventId, providerRef: p.providerRef, status });
    expect(retried.status).toBe(200);
    expect(retried.json.message).toBe("event processed");
    const after = await state(p);
    expect(after.payment!.status).toBe(status === "SUCCESS" ? "Success" : "Failed");
    expect(after.booking!.status).toBe(status === "SUCCESS" ? "Confirmed" : "Failed");
  });

  test("a crash while cancelling rolls back the cancel and the refund", async () => {
    const p = await startPayment();
    await sendWebhook({ eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" });
    // the booking is cancelled, then the refund crashes
    const stopCrashing = await crashOnUpdate("Payment", p.paymentId);

    const r = await call(`/user/booking/booking/${p.bookingId}/cancel`, {}, f.userToken);
    expect(r.status).toBe(500);
    const s = await state(p);
    expect(s.booking!.status).toBe("Confirmed");
    expect(s.payment!.status).toBe("Success");

    await stopCrashing();
    const retried = await call(`/user/booking/booking/${p.bookingId}/cancel`, {}, f.userToken);
    expect(retried.json).toMatchObject({ status: "Cancelled", refunded: true });
    expect((await state(p)).payment!.status).toBe("Refunded");
  });
});

describe("webhook delivery retries", () => {
  const webhookUrl = () => `${serverOrigin()}/payments/webhook`;
  const fast = { maxAttempts: 5, baseDelayMs: 50 };

  test("the provider retries a FAILED event until it goes through, and it is applied once", async () => {
    const p = await startPayment();
    // the first two deliveries crash inside the transaction (500); the third one succeeds
    await crashOnUpdate("Booking", p.bookingId, 2);
    const event = { eventId: newEventId(), providerRef: p.providerRef, status: "FAILED" as const, failureReason: "card_declined" };

    const result = await deliverWebhook(webhookUrl(), event, SECRET, fast);
    expect(result).toEqual({ delivered: true, attempts: 3 });

    const s = await state(p);
    expect(s.payment).toMatchObject({ status: "Failed", failureReason: "card_declined" });
    expect(s.booking!.status).toBe("Failed");
    expect(await prisma.webhook.count({ where: { eventID: event.eventId } })).toBe(1);
  });

  test("a retry of an event that was already applied is harmless", async () => {
    const p = await startPayment();
    const event = { eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" as const };
    // e.g. the first delivery was processed but its response got lost, so the provider sends it again
    expect((await deliverWebhook(webhookUrl(), event, SECRET, fast)).delivered).toBe(true);
    expect((await deliverWebhook(webhookUrl(), event, SECRET, fast)).delivered).toBe(true);
    expect(await prisma.webhook.count({ where: { eventID: event.eventId } })).toBe(1);
    expect((await state(p)).booking!.status).toBe("Confirmed");
  });

  test("it stops immediately when the event is rejected (wrong secret)", async () => {
    const p = await startPayment();
    const event = { eventId: newEventId(), providerRef: p.providerRef, status: "SUCCESS" as const };
    const result = await deliverWebhook(webhookUrl(), event, "wrong-secret", fast);
    expect(result).toEqual({ delivered: false, attempts: 1 });
    expect((await state(p)).payment!.status).toBe("Created");
  });

  test("it gives up after the maximum attempts when the server is unreachable", async () => {
    const event = { eventId: newEventId(), providerRef: "mock_pay_x", status: "SUCCESS" as const };
    const result = await deliverWebhook("http://127.0.0.1:9/payments/webhook", event, SECRET, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toEqual({ delivered: false, attempts: 3 });
  });
});

describe("retryOnConflict", () => {
  const conflict = Object.assign(new Error("deadlock"), { code: "P2034" });

  test("reruns a transaction that postgres aborted for a deadlock", async () => {
    let calls = 0;
    const result = await retryOnConflict(async () => {
      calls++;
      if (calls < 3) throw conflict;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("gives up after 3 attempts", async () => {
    let calls = 0;
    await expect(retryOnConflict(async () => { calls++; throw conflict; })).rejects.toThrow("deadlock");
    expect(calls).toBe(3);
  });

  test("does not retry other errors", async () => {
    let calls = 0;
    await expect(retryOnConflict(async () => { calls++; throw new Error("boom"); })).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });
});
