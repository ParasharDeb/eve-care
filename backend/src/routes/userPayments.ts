import { Router } from "express";
import { userAuthMiddleware, type UserRequest } from "../middleware/userAuthMiddleware";
import { idempotencyKeySchema, paymentTypes } from "../types/paymentTypes";
import prisma from "@repo/db";
export const PaymentRouter=Router()

PaymentRouter.post("/",userAuthMiddleware,async(req:UserRequest,res)=>{
    const parsed=paymentTypes.safeParse(req.body);
    const userId=req.user!.id
    const parsedKey=idempotencyKeySchema.safeParse(req.headers["idempotency-key"])
    if(!parsedKey.success){
        req.log.warn("payment rejected: missing or invalid Idempotency-Key header")
        res.status(400).json({
            message:"Idempotency-Key header must be a UUID"
        })
        return
    }
    const idempotencyKey=parsedKey.data
    const providerRef=`mockpay_${crypto.randomUUID()}` //like razonpay will give the id 
    if(!parsed.success){
        res.json({
            message:"some message"
        })
        return
    }
    const booking = await prisma.booking.findFirst({
    where: {
        id: parsed.data.bookingId,
        userId: userId,          
    },
    include: {
        payments: true,          
    },
})

const existingpayment= await prisma.payment.findUnique({
    where:{
        idempotencyKey:idempotencyKey
    }
})
if(existingpayment?.bookingId==parsed.data.bookingId){
    res.json({
        message:`payment statys ${existingpayment.status}`
    })
    return
}
if(existingpayment?.bookingId!=parsed.data.bookingId){
    return
}

if (!booking) {
    // doesn't exist, or belongs to someone else
    res.status(404).json({ message: "booking not found" })
    return
}
if (booking.status !== "Pending") {
    // Confirmed = already paid; Failed/Cancelled = can't be paid
    res.status(409).json({ message: `booking is already ${booking.status.toLowerCase()}` })
    return
}
if (booking.payments) {
    // payment started but not settled yet (webhook hasn't arrived)
    res.status(409).json({ message: "payment already in progress for this booking" })
    return
}

    try {
        const payment= await prisma.payment.create({
        data:{
            idempotencyKey:idempotencyKey,
            bookingId:parsed.data.bookingId,
            amount:booking.price,
            providerRef:providerRef
        }
        }) 

        res.json({
            id:payment.id,
            status:payment.status,
            price:payment.amount,
            bookingId:booking.id,
        })
    } catch (error) {
        console.log(error)
        res.json({
            mesasge:error
        })
    }
})