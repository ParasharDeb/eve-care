import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { createExtraTest, get, setup, teardown, type Fixture } from "./helpers";

let f: Fixture;
beforeAll(async () => { f = await setup(); }, 60_000);
afterAll(teardown, 60_000);

describe("GET /centres", () => {
  test("is public, no token needed", async () => {
    const r = await get("/centres");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.centres)).toBe(true);
  });

  test("finds a centre by partial name, case-insensitively", async () => {
    const r = await get(`/centres?search=${encodeURIComponent(f.hospitalName.slice(0, -3).toUpperCase())}`);
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(1);
    expect(r.json.centres[0]).toMatchObject({ id: f.hospitalId, hopitalname: f.hospitalName, location: "City", _count: { Tests: 1 } });
  });

  test("never leaks email, password or refresh token", async () => {
    const r = await get(`/centres?search=${encodeURIComponent(f.hospitalName)}`);
    expect(Object.keys(r.json.centres[0]).sort()).toEqual(["_count", "hopitalname", "id", "location"]);
  });

  test("filters by location together with search", async () => {
    const hit = await get(`/centres?search=${encodeURIComponent(f.hospitalName)}&location=city`);
    expect(hit.json.total).toBe(1);
    const miss = await get(`/centres?search=${encodeURIComponent(f.hospitalName)}&location=zzz-nowhere`);
    expect(miss.status).toBe(200);
    expect(miss.json).toMatchObject({ centres: [], total: 0, totalPages: 0 });
  });

  test("defaults to page 1 with 10 per page", async () => {
    const r = await get("/centres");
    expect(r.json).toMatchObject({ page: 1, limit: 10 });
    expect(r.json.centres.length).toBeLessThanOrEqual(10);
  });

  test("pages don't overlap and totalPages matches total", async () => {
    const first = await get("/centres?page=1&limit=1");
    const second = await get("/centres?page=2&limit=1");
    expect(first.json.totalPages).toBe(first.json.total);
    if (first.json.total >= 2) {
      expect(second.json.centres[0].id).not.toBe(first.json.centres[0].id);
    }
  });

  test("a page past the end is empty, not an error", async () => {
    const r = await get("/centres?page=100000");
    expect(r.status).toBe(200);
    expect(r.json.centres).toEqual([]);
  });

  test.each([
    ["page 0", "page=0"],
    ["negative limit", "limit=-1"],
    ["limit over 50", "limit=51"],
    ["non-numeric page", "page=abc"],
    ["fractional limit", "limit=2.5"],
  ])("returns 400 for %s", async (_name, query) => {
    const r = await get(`/centres?${query}`);
    expect(r.status).toBe(400);
  });
});

describe("GET /centres/:id", () => {
  test("returns the centre with its tests and prices", async () => {
    const extra = await createExtraTest(f, "Aaa Scan", 1200);
    const r = await get(`/centres/${f.hospitalId}`);
    expect(r.status).toBe(200);
    expect(r.json.centre).toMatchObject({ id: f.hospitalId, hopitalname: f.hospitalName, location: "City" });
    // sorted by name
    expect(r.json.centre.Tests).toEqual([
      { id: extra.id, name: extra.name, price: 1200 },
      { id: f.testId, name: f.testName, price: 500 },
    ]);
  });

  test("never leaks email, password or refresh token", async () => {
    const r = await get(`/centres/${f.hospitalId}`);
    expect(Object.keys(r.json.centre).sort()).toEqual(["Tests", "hopitalname", "id", "location"]);
  });

  test("returns 404 for an unknown centre", async () => {
    const r = await get(`/centres/${randomUUID()}`);
    expect(r.status).toBe(404);
  });

  test("returns 400 for an id that isn't a UUID", async () => {
    const r = await get("/centres/not-a-uuid");
    expect(r.status).toBe(400);
  });
});
