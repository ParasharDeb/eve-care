import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { call, futureDate, get, prisma, send, setup, teardown, type Fixture } from "./helpers";

let f: Fixture;
let otherHospitalId: string;
let otherTestId: string;
beforeAll(async () => {
  f = await setup();
  const other = await prisma.hospital.create({
    data: { email: `${randomUUID()}@other.test`, hopitalname: `Other ${randomUUID()}`, password: "x", location: "Elsewhere", refrestoken: "" },
  });
  otherHospitalId = other.id;
  otherTestId = (await prisma.test.create({ data: { name: "Other test", price: 100, hospitalId: other.id } })).id;
}, 60_000);
afterAll(async () => {
  await prisma.test.deleteMany({ where: { hospitalId: otherHospitalId } });
  await prisma.hospital.delete({ where: { id: otherHospitalId } });
  await teardown();
}, 60_000);

const base = "/hospital/tests";
const addTest = (body: object = { name: "Vitamin B12", price: 650 }, token = f.hospitalToken) => call(`${base}/add-test`, body, token);

describe("GET /my-tests", () => {
  test("lists only the hospital's own tests", async () => {
    const r = await get(`${base}/my-tests`, f.hospitalToken);
    expect(r.status).toBe(200);
    expect(r.json.tests.every((t: { hospitalId: string }) => t.hospitalId === f.hospitalId)).toBe(true);
    expect(r.json.tests.some((t: { id: string }) => t.id === f.testId)).toBe(true);
  });

  test("rejects a user token", async () => {
    expect((await get(`${base}/my-tests`, f.userToken)).status).toBe(401);
  });
});

describe("POST /add-test", () => {
  test("adds a test to the hospital from the token", async () => {
    const r = await addTest({ name: "Vitamin B12", price: 650, hospitalId: otherHospitalId });
    expect(r.status).toBe(201);
    expect(r.json.test).toMatchObject({ name: "Vitamin B12", price: 650, hospitalId: f.hospitalId });
  });

  test.each([
    ["missing name", { price: 100 }],
    ["empty name", { name: "  ", price: 100 }],
    ["missing price", { name: "X" }],
    ["negative price", { name: "X", price: -1 }],
    ["decimal price", { name: "X", price: 10.5 }],
    ["price as string", { name: "X", price: "100" }],
  ])("returns 400 for %s", async (_name, body) => {
    expect((await addTest(body)).status).toBe(400);
  });

  test("rejects a user token", async () => {
    expect((await addTest(undefined, f.userToken)).status).toBe(401);
  });
});

describe("PUT /update-test/:id", () => {
  test("updates name and price", async () => {
    const created = await addTest();
    const r = await send("PUT", `${base}/update-test/${created.json.test.id}`, { name: "Vitamin B12 (fasting)", price: 700 }, f.hospitalToken);
    expect(r.status).toBe(200);
    expect(r.json.test).toMatchObject({ name: "Vitamin B12 (fasting)", price: 700 });
  });

  test("updates only the fields sent", async () => {
    const created = await addTest();
    const r = await send("PUT", `${base}/update-test/${created.json.test.id}`, { price: 999 }, f.hospitalToken);
    expect(r.status).toBe(200);
    expect(r.json.test).toMatchObject({ name: "Vitamin B12", price: 999 });
  });

  test("a price change does not change existing bookings", async () => {
    const created = await addTest({ name: "Price change", price: 400 });
    const booking = await call("/user/booking/booking", { testid: created.json.test.id, date: futureDate() }, f.userToken);
    await send("PUT", `${base}/update-test/${created.json.test.id}`, { price: 900 }, f.hospitalToken);
    const stored = await prisma.booking.findUnique({ where: { id: booking.json.booking.id } });
    expect(stored!.price).toBe(400);
    await prisma.booking.delete({ where: { id: booking.json.booking.id } });
  });

  test("returns 404 for another hospital's test", async () => {
    const r = await send("PUT", `${base}/update-test/${otherTestId}`, { price: 1 }, f.hospitalToken);
    expect(r.status).toBe(404);
    expect((await prisma.test.findUnique({ where: { id: otherTestId } }))!.price).toBe(100);
  });

  test("returns 404 for an unknown test", async () => {
    expect((await send("PUT", `${base}/update-test/${randomUUID()}`, { price: 1 }, f.hospitalToken)).status).toBe(404);
  });

  test("returns 400 for a non-uuid id or a bad body", async () => {
    expect((await send("PUT", `${base}/update-test/abc`, { price: 1 }, f.hospitalToken)).status).toBe(400);
    expect((await send("PUT", `${base}/update-test/${f.testId}`, { price: -1 }, f.hospitalToken)).status).toBe(400);
  });
});

describe("DELETE /remove-test/:id", () => {
  test("removes a test without bookings", async () => {
    const created = await addTest();
    const r = await send("DELETE", `${base}/remove-test/${created.json.test.id}`, undefined, f.hospitalToken);
    expect(r.status).toBe(200);
    expect(await prisma.test.findUnique({ where: { id: created.json.test.id } })).toBeNull();
  });

  test("returns 409 for a test that has bookings", async () => {
    const created = await addTest({ name: "Booked", price: 200 });
    const booking = await call("/user/booking/booking", { testid: created.json.test.id, date: futureDate() }, f.userToken);
    const r = await send("DELETE", `${base}/remove-test/${created.json.test.id}`, undefined, f.hospitalToken);
    expect(r.status).toBe(409);
    await prisma.booking.delete({ where: { id: booking.json.booking.id } });
  });

  test("returns 404 for another hospital's test", async () => {
    const r = await send("DELETE", `${base}/remove-test/${otherTestId}`, undefined, f.hospitalToken);
    expect(r.status).toBe(404);
    expect(await prisma.test.findUnique({ where: { id: otherTestId } })).not.toBeNull();
  });

  test("returns 400 for a non-uuid id", async () => {
    expect((await send("DELETE", `${base}/remove-test/abc`, undefined, f.hospitalToken)).status).toBe(400);
  });

  test("rejects a user token", async () => {
    expect((await send("DELETE", `${base}/remove-test/${f.testId}`, undefined, f.userToken)).status).toBe(401);
  });
});
