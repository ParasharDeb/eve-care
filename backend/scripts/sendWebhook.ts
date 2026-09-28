// Sends a signed webhook to the running API, the same way the payment provider would.
//
//   bun run webhook <paymentId> SUCCESS
//   bun run webhook <paymentId> FAILED
//   bun run webhook <paymentId> SUCCESS <eventId>   <- resend an old event to see idempotency
//
// Reads WEBHOOK_SECRET and DATABASE_URL from backend/.env. Set WEBHOOK_URL to target another server.
import { createHmac, randomUUID } from "crypto"
import prisma from "@repo/db"

const [paymentId, status, eventId = `evt_${randomUUID()}`] = process.argv.slice(2)
if (!paymentId || (status !== "SUCCESS" && status !== "FAILED")) {
    console.error("usage: bun run webhook <paymentId> <SUCCESS|FAILED> [eventId]")
    process.exit(1)
}
const secret = process.env.WEBHOOK_SECRET
if (!secret) {
    console.error("WEBHOOK_SECRET is not set in backend/.env")
    process.exit(1)
}

// the provider only knows its own id for the payment, so look it up
const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
await prisma.$disconnect()
if (!payment?.providerRef) {
    console.error(`no payment with id ${paymentId}`)
    process.exit(1)
}

const body = JSON.stringify({
    eventId,
    providerRef: payment.providerRef,
    status,
    ...(status === "FAILED" ? { failureReason: "card_declined" } : {}),
})
const signature = createHmac("sha256", secret).update(body).digest("hex")
const url = process.env.WEBHOOK_URL ?? "http://localhost:8080/payments/webhook"

const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature },
    body,
})
console.log(`POST ${url}`)
console.log(`body:      ${body}`)
console.log(`response:  ${res.status} ${await res.text()}`)
