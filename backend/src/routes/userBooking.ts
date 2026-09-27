import { Router } from "express";
import prisma from "@repo/db";
import { SearchHospitalSchema, SearchTestSchema } from "../types/UserSearch";
import { userAuthMiddleware } from "../middleware/userAuthMiddleware";

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
                equals:hospital.data.hospital,
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
        equals:testname.data.testname,
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
userBookingRouter.get("/bookings",userAuthMiddleware,(req,res)=>{
    // gets all the users bookings by id
})
userBookingRouter.get("/nearest-hospital",userAuthMiddleware,(req,res)=>{
    // get all the hospitals near the user
    // need to add user location in the user table
})
userBookingRouter.post("/booking",userAuthMiddleware,(req,res)=>{

})
userBookingRouter.get("/booking/:id",userAuthMiddleware,(req,res)=>{

})
userBookingRouter.get("/bookings",userAuthMiddleware,(req,res)=>{

})