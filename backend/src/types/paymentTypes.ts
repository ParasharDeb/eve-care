import {z} from "zod"
export const paymentTypes=z.object({
    bookingId:z.uuid(),
    simulate:z.enum(["success","failure"]).optional()
})

export const idempotencyKeySchema=z.uuid()

export const paymentIdSchema=z.uuid()

export const webhookTypes=z.object({
    eventId:z.string().min(1),
    providerRef:z.string().min(1),
    status:z.enum(["SUCCESS","FAILED"]),
    failureReason:z.string().optional()
})
