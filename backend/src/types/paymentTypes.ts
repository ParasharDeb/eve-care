import {z} from "zod"
export const paymentTypes=z.object({
    bookingId:z.uuid(),
    simulate:z.enum(["success","failure"]).optional()
})

export const idempotencyKeySchema=z.uuid()

export const paymentIdSchema=z.uuid()
