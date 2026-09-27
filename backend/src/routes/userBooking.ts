import { Router } from "express";
import prisma from "@repo/db";
import { SearchHospitalSchema, SearchTestSchema } from "../types/UserSearch";
import { userAuthMiddleware, type UserRequest } from "../middleware/userAuthMiddleware";
import { BookingIdSchema, BookingSchema } from "../types/UserBooking";

export const userBookingRouter=Router()


userBookingRouter.post("/search-by-hospital",userAuthMiddleware,async(req,res)=>{
    const hospital=SearchHospitalSchema.safeParse(req.body)
    if(!hospital.success){
        req.log.warn("search-by-hospital validation failed")
        res.status(400).json({
            message:"enter a valid hospital name"
        })
        return
    }

    const data= await prisma.hospital.findFirst({
        where:{
            hopitalname:{
                contains:hospital.data.hospital,
                mode: "insensitive"
            }
        }
    })
    if(!data){
        req.log.info({ query:hospital.data.hospital },"search-by-hospital: no match")
        res.status(404).json({
            message:"this hospital is not in our database"
        })
        return
    }
    const hospitalId=data.id
    const tests= await prisma.test.findMany({
        where:{
            hospitalId:hospitalId
        }
    })
    req.log.info({ hospitalId, results:tests.length },"search-by-hospital")
    res.json({
        tests:tests
    })
})
userBookingRouter.post("/search-by-tests",userAuthMiddleware,async(req,res)=>{
    const testname=SearchTestSchema.safeParse(req.body)
    if(!testname.success){
        req.log.warn("search-by-tests validation failed")
        res.status(400).json({
            message:"enter a valid test name"
        })
        return
    }
    const data = await prisma.test.findMany({
    where: {
        name: {
        contains:testname.data.testname,
        mode: "insensitive"}
    },
    select: {
        name: true,
        price: true,
        hospital: {
            select: {
                id: true,
                hopitalname: true,
                location: true
            }
        }
    }
    })

    req.log.info({ query:testname.data.testname, results:data.length },"search-by-tests")
    res.json({
        data
    })
})
userBookingRouter.get("/nearest-hospital",userAuthMiddleware,(req,res)=>{
    // get all the hospitals near the user
    // need to add user location in the user table
})
userBookingRouter.post("/booking",userAuthMiddleware,async(req:UserRequest,res)=>{
    const parsed=BookingSchema.safeParse(req.body)
    if(!parsed.success){
        req.log.warn({ issues: parsed.error.issues.map(i=>i.path.join(".")) },"booking validation failed")
        res.status(400).json({
            message:"enter a valid test id and appointment date"
        })
        return
    }
    const date=new Date(parsed.data.date)
    if(date<=new Date()){
        req.log.warn("booking rejected: appointment date is not in the future")
        res.status(400).json({
            message:"appointment date must be in the future"
        })
        return
    }
    const userId=req.user!.id
    const testId=parsed.data.testid

    try {
        const test=await prisma.test.findUnique({
            where:{
                id:testId
            }
        })
        if(!test){
            req.log.info({ testId },"booking rejected: test not found")
            res.status(404).json({
                message:"this test doesnt exist anymore"
            })
            return
        }

        // a user may rebook a test once the previous booking failed or was cancelled
        const activeBooking=await prisma.booking.findFirst({
            where:{
                userId:userId,
                testId:testId,
                status:{ in:["Pending","Confirmed"] }
            }
        })
        if(activeBooking){
            req.log.warn({ userId, testId, bookingId:activeBooking.id },"booking rejected: active booking exists")
            res.status(409).json({
                message:"You already have a booking for this test. please check your bookings"
            })
            return
        }

        
        const booking=await prisma.booking.create({
            data:{
                userId:userId,
                testId:testId,
                price:test.price,
                status:"Pending",
                date:date
            }
        })
        req.log.info({ userId, testId, bookingId:booking.id },"booking created")
        res.status(201).json({
            booking
        })
    } catch (error) {
        const code=(error as { code?: string }).code
        // concurrent request for the same booking won the unique constraint
        if(code==="P2002"){
            req.log.warn({ userId, testId },"booking rejected: unique constraint")
            res.status(409).json({
                message:"You already have a booking for this test. please check your bookings"
            })
            return
        }
        // token is valid but the user row no longer exists
        if(code==="P2003"){
            req.log.warn({ userId },"booking rejected: user not found")
            res.status(401).json({
                message:"you are not signed in"
            })
            return
        }
        req.log.error({ err:error, userId, testId },"booking failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})
userBookingRouter.get("/booking/:id",userAuthMiddleware,async(req:UserRequest,res)=>{
    const bookingId=BookingIdSchema.safeParse(req.params.id)
    if(!bookingId.success){
        req.log.warn("get booking: invalid booking id")
        res.status(400).json({
            message:"Invalid booking ID"
        })
        return
    }
    const userId=req.user!.id

    try {
        const booking=await prisma.booking.findFirst({
            where:{
                id:bookingId.data,
                userId:userId
            },
            include:{
                test:{
                    select:{
                        id:true,
                        name:true,
                        hospital:{
                            select:{
                                id:true,
                                hopitalname:true,
                                location:true
                            }
                        }
                    }
                },
                payments:{
                    select:{
                        id:true,
                        status:true,
                        amount:true,
                        failureReason:true
                    }
                }
            }
        })
        if(!booking){
            req.log.info({ userId, bookingId:bookingId.data },"get booking: not found")
            res.status(404).json({
                message:"booking not found"
            })
            return
        }
        req.log.info({ userId, bookingId:booking.id },"get booking")
        res.json({
            booking
        })
    } catch (error) {
        req.log.error({ err:error, userId, bookingId:bookingId.data },"get booking failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})
userBookingRouter.get("/bookings",userAuthMiddleware,async(req:UserRequest,res)=>{
    const userId=req.user!.id

    try {
        const bookings=await prisma.booking.findMany({
            where:{
                userId:userId
            },
            orderBy:{
                createdAt:"desc"
            },
            include:{
                test:{
                    select:{
                        id:true,
                        name:true,
                        hospital:{
                            select:{
                                id:true,
                                hopitalname:true,
                                location:true
                            }
                        }
                    }
                },
                payments:{
                    select:{
                        id:true,
                        status:true
                    }
                }
            }
        })
        req.log.info({ userId, results:bookings.length },"list bookings")
        res.json({
            bookings
        })
    } catch (error) {
        req.log.error({ err:error, userId },"list bookings failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})
