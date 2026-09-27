import type { Server } from "http";
import type { AddressInfo } from "net";
import jwt from "jsonwebtoken";
import prisma from "@repo/db";
import { app } from "../src/app";

export { prisma };

export type Fixture = {
  userToken: string;
  user2Token: string;
  hospitalToken: string;
  userId: string;
  user2Id: string;
  hospitalId: string;
  hospitalName: string;
  testId: string;
  testName: string;
};

let server: Server;
let baseUrl = "";
let origin = "";
let tag = "";
const password = "Passw0rd!";

// /payments is mounted at the root like the brief says; everything else lives under /api
const url = (path: string) => (path.startsWith("/payments") ? origin : baseUrl) + path;

export async function call(path: string, body?: unknown, token?: string, rawBody?: string, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
  if (token !== undefined) headers.Authorization = token;
  const res = await fetch(url(path), {
    method: "POST",
    headers,
    body: rawBody ?? JSON.stringify(body ?? {}),
  });
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

export async function get(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.Authorization = token;
  const res = await fetch(url(path), { headers });
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

export async function send(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token !== undefined) headers.Authorization = token;
  const res = await fetch(url(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

export function signToken(userId: string, secret: string, expiresIn: jwt.SignOptions["expiresIn"] = "5m") {
  return jwt.sign({ userId }, secret, { expiresIn });
}

export async function setup(): Promise<Fixture> {
  tag = `t${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  baseUrl = `${origin}/api`;

  const email = `${tag}@test.com`;
  const email2 = `${tag}b@test.com`;
  const hospitalEmail = `${tag}h@test.com`;
  const hospitalName = `Hosp ${tag}`;

  await call("/user/auth/signup", { username: "tester", email, password });
  await call("/user/auth/signup", { username: "tester2", email: email2, password });
  await call("/hospital/auth/signup", { hospitalname: hospitalName, email: hospitalEmail, password, location: "City" });
  const u1 = await call("/user/auth/signin", { email, password });
  const u2 = await call("/user/auth/signin", { email: email2, password });
  const h = await call("/hospital/auth/signin", { email: hospitalEmail, password });
  if (!u1.json?.accessToken || !u2.json?.accessToken || !h.json?.accessToken) {
    throw new Error(`fixture signin failed: ${JSON.stringify({ u1, u2, h })}`);
  }

  const userId = (jwt.decode(u1.json.accessToken) as { userId: string }).userId;
  const user2Id = (jwt.decode(u2.json.accessToken) as { userId: string }).userId;
  const hospitalId = (jwt.decode(h.json.accessToken) as { userId: string }).userId;
  const testName = `Blood ${tag}`;
  const test = await prisma.test.create({ data: { name: testName, price: 500, hospitalId } });

  return {
    userToken: `Bearer ${u1.json.accessToken}`,
    user2Token: `Bearer ${u2.json.accessToken}`,
    hospitalToken: `Bearer ${h.json.accessToken}`,
    userId,
    user2Id,
    hospitalId,
    hospitalName,
    testId: test.id,
    testName,
  };
}

export async function teardown() {
  await prisma.payment.deleteMany({ where: { booking: { user: { email: { startsWith: tag } } } } });
  await prisma.booking.deleteMany({ where: { user: { email: { startsWith: tag } } } });
  await prisma.test.deleteMany({ where: { hospital: { email: { startsWith: tag } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
  await prisma.hospital.deleteMany({ where: { email: { startsWith: tag } } });
  server?.close();
}

export function futureDate(daysAhead = 30) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(10, 30, 0, 0);
  return d.toISOString();
}

// a second test at the fixture hospital, for "same user, different test" cases
export async function createExtraTest(f: Fixture, name = "Extra", price = 900) {
  return prisma.test.create({ data: { name: `${name} ${tag}`, price, hospitalId: f.hospitalId } });
}
