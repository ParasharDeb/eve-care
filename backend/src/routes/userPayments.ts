import { Router } from "express";
import { randomUUID } from "crypto";
import prisma from "@repo/db";
import { userAuthMiddleware, type UserRequest } from "../middleware/userAuthMiddleware";
import { idempotencyKeySchema, paymentIdSchema, paymentTypes } from "../types/paymentTypes";

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

        const payment=await prisma.payment.create({
            data:{
                idempotencyKey:idempotencyKey,
                bookingId:booking.id,
                amount:booking.price,
                // stands in for the transaction id a real gateway like razorpay would return
                providerRef:`mock_pay_${randomUUID()}`
            },
            select:paymentSelect
        })
        // TODO phase 4: hand the payment to the mock provider, which settles it via the webhook
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
