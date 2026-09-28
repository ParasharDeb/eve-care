import { Router } from "express";
import { randomUUID, timingSafeEqual } from "crypto";
import prisma from "@repo/db";
import { userAuthMiddleware, type UserRequest } from "../middleware/userAuthMiddleware";
import { idempotencyKeySchema, paymentIdSchema, paymentTypes, webhookTypes } from "../types/paymentTypes";
import { processPayment, signWebhook } from "../utils/mockProvider";
import { retryOnConflict } from "../utils/retry";

export const PaymentRouter=Router()

// what the client sees; idempotencyKey and providerRef stay internal
const paymentSelect={
    id:true,
    bookingId:true,
    amount:true,
    status:true,
    failureReason:true,
    createdAt:true
} as const

PaymentRouter.post("/",userAuthMiddleware,async(req:UserRequest,res)=>{
    // headers are string | string[]; the schema only accepts a single UUID string
    const parsedKey=idempotencyKeySchema.safeParse(req.headers["idempotency-key"])
    if(!parsedKey.success){
        req.log.warn("payment rejected: missing or invalid Idempotency-Key header")
        res.status(400).json({
            message:"Idempotency-Key header must be a UUID"
        })
        return
    }
    const parsed=paymentTypes.safeParse(req.body)
    if(!parsed.success){
        req.log.warn({ issues: parsed.error.issues.map(i=>i.path.join(".")) },"payment validation failed")
        res.status(400).json({
            message:"enter a valid booking id"
        })
        return
    }
    const userId=req.user!.id
    const idempotencyKey=parsedKey.data
    const bookingId=parsed.data.bookingId

    try {
        const booking=await prisma.booking.findFirst({
            where:{
                id:bookingId,
                userId:userId
            },
            include:{
                payments:true
            }
        })
        if(!booking){
            // doesn't exist, or belongs to someone else
            req.log.info({ userId, bookingId },"payment rejected: booking not found")
            res.status(404).json({
                message:"booking not found"
            })
            return
        }

        const existingPayment=await prisma.payment.findUnique({
            where:{
                idempotencyKey:idempotencyKey
            },
            select:paymentSelect
        })
        if(existingPayment){
            if(existingPayment.bookingId===booking.id){
                req.log.info({ userId, paymentId:existingPayment.id },"payment replayed")
                res.status(200).json({
                    payment:existingPayment
                })
                return
            }
            req.log.warn({ userId, bookingId },"payment rejected: idempotency key reused for another booking")
            res.status(422).json({
                message:"this Idempotency-Key was already used for a different booking"
            })
            return
        }

        if(booking.status!=="Pending"){
            // Confirmed = already paid; Failed/Cancelled = can't be paid
            req.log.warn({ userId, bookingId, status:booking.status },"payment rejected: booking not payable")
            res.status(409).json({
                message:`booking is already ${booking.status.toLowerCase()}`
            })
            return
        }
        if(booking.payments){
            // payment started but not settled yet (webhook hasn't arrived)
            req.log.warn({ userId, bookingId },"payment rejected: payment already in progress")
            res.status(409).json({
                message:"payment already in progress for this booking"
            })
            return
        }

        // stands in for the transaction id a real gateway like razorpay would return
        const providerRef=`mock_pay_${randomUUID()}`
        const payment=await prisma.payment.create({
            data:{
                idempotencyKey:idempotencyKey,
                bookingId:booking.id,
                amount:booking.price,
                providerRef:providerRef
            },
            select:paymentSelect
        })
        // only after the payment is saved: the provider reports the result to POST /payments/webhook
        processPayment(providerRef,parsed.data.simulate)
        req.log.info({ userId, bookingId, paymentId:payment.id },"payment created")
        res.status(202).location(`/payments/${payment.id}`).json({
            payment
        })
    } catch (error) {
        // a concurrent request inserted first: bookingId and idempotencyKey are both unique
        if((error as { code?: string }).code==="P2002"){
            const winner=await prisma.payment.findUnique({
                where:{
                    idempotencyKey:idempotencyKey
                },
                select:paymentSelect
            })
            if(winner && winner.bookingId===bookingId){
                req.log.info({ userId, paymentId:winner.id },"payment replayed after concurrent request")
                res.status(200).json({
                    payment:winner
                })
                return
            }
            req.log.warn({ userId, bookingId },"payment rejected: concurrent payment for this booking")
            res.status(409).json({
                message:"payment already in progress for this booking"
            })
            return
        }
        req.log.error({ err:error, userId, bookingId },"payment failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})

// the provider signs the raw body with the shared WEBHOOK_SECRET, the same way razorpay/stripe do
function isValidSignature(rawBody:Buffer|undefined,signature:unknown){
    const secret=process.env.WEBHOOK_SECRET
    if(!secret || !rawBody || typeof signature!=="string"){
        return false
    }
    const expected=signWebhook(rawBody,secret)
    if(signature.length!==expected.length){
        return false
    }
    return timingSafeEqual(Buffer.from(signature),Buffer.from(expected))
}

PaymentRouter.post("/webhook",async(req,res)=>{
    const rawBody=(req as { rawBody?: Buffer }).rawBody
    if(!isValidSignature(rawBody,req.headers["x-webhook-signature"])){
        req.log.warn("webhook rejected: invalid signature")
        res.status(401).json({
            message:"invalid signature"
        })
        return
    }
    const parsed=webhookTypes.safeParse(req.body)
    if(!parsed.success){
        req.log.warn({ issues: parsed.error.issues.map(i=>i.path.join(".")) },"webhook validation failed")
        res.status(400).json({
            message:"invalid webhook event"
        })
        return
    }
    const event=parsed.data
    const paymentSucceeded=event.status==="SUCCESS"

    try {
        const payment=await prisma.payment.findUnique({
            where:{
                providerRef:event.providerRef
            }
        })
        if(!payment){
            // nothing is recorded, so when the provider retries it isn't mistaken for a duplicate
            req.log.warn({ eventId:event.eventId, providerRef:event.providerRef },"webhook: payment not found")
            res.status(404).json({
                message:"payment not found"
            })
            return
        }

        // everything inside commits together or not at all; a deadlock with a cancel is retried
        const result=await retryOnConflict(()=>prisma.$transaction(async(tx)=>{
            // eventID is unique, so a repeated event throws here and nothing below runs
            await tx.webhook.create({
                data:{
                    eventID:event.eventId,
                    type:paymentSucceeded?"payment.succeeded":"payment.failed",
                    payload:rawBody!.toString(),
                    status:"processed",
                    recivedAt:new Date()
                }
            })

            // only a payment still waiting for its result can change, so a late or conflicting event does nothing
            const updatedPayment=await tx.payment.updateMany({
                where:{
                    id:payment.id,
                    status:"Created"
                },
                data:{
                    status:paymentSucceeded?"Success":"Failed",
                    failureReason:paymentSucceeded?null:(event.failureReason ?? "payment_failed")
                }
            })
            if(updatedPayment.count===0){
                await tx.webhook.update({
                    where:{
                        eventID:event.eventId
                    },
                    data:{
                        status:"ignored"
                    }
                })
                return "ignored"
            }

            const updatedBooking=await tx.booking.updateMany({
                where:{
                    id:payment.bookingId,
                    status:"Pending"
                },
                data:{
                    status:paymentSucceeded?"Confirmed":"Failed"
                }
            })
            // the booking was cancelled while the payment was running: the money was taken
            // for nothing, so give it back (simulated refund) and keep the booking cancelled
            if(updatedBooking.count===0 && paymentSucceeded){
                await tx.payment.update({
                    where:{
                        id:payment.id
                    },
                    data:{
                        status:"Refunded"
                    }
                })
                return "refunded"
            }
            return "processed"
        }))

        if(result==="refunded"){
            req.log.info({ eventId:event.eventId, paymentId:payment.id },"webhook: booking was cancelled, payment refunded")
            res.json({
                message:"booking was cancelled, payment refunded"
            })
            return
        }
        if(result==="ignored"){
            req.log.info({ eventId:event.eventId, paymentId:payment.id, paymentStatus:payment.status },"webhook ignored: payment already settled")
            res.json({
                message:"payment already settled, event ignored"
            })
            return
        }
        req.log.info({ eventId:event.eventId, paymentId:payment.id, status:event.status },"webhook processed")
        res.json({
            message:"event processed"
        })
    } catch (error) {
        // the same event arrived again: answer 200 so the provider stops retrying
        if((error as { code?: string }).code==="P2002"){
            req.log.info({ eventId:event.eventId },"webhook duplicate: event already processed")
            res.json({
                message:"event already processed"
            })
            return
        }
        req.log.error({ err:error, eventId:event.eventId },"webhook failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})

PaymentRouter.get("/:id",userAuthMiddleware,async(req:UserRequest,res)=>{
    const paymentId=paymentIdSchema.safeParse(req.params.id)
    if(!paymentId.success){
        req.log.warn("get payment: invalid payment id")
        res.status(400).json({
            message:"Invalid payment ID"
        })
        return
    }
    const userId=req.user!.id

    try {
        // filtering through the booking's owner makes someone else's payment look missing
        const payment=await prisma.payment.findFirst({
            where:{
                id:paymentId.data,
                booking:{
                    userId:userId
                }
            },
            select:{
                ...paymentSelect,
                booking:{
                    select:{
                        id:true,
                        status:true
                    }
                }
            }
        })
        if(!payment){
            req.log.info({ userId, paymentId:paymentId.data },"get payment: not found")
            res.status(404).json({
                message:"payment not found"
            })
            return
        }
        req.log.info({ userId, paymentId:payment.id },"get payment")
        res.json({
            payment
        })
    } catch (error) {
        req.log.error({ err:error, userId, paymentId:paymentId.data },"get payment failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})
