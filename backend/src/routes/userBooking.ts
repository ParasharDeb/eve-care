import { Router } from "express";
import prisma from "@repo/db";
import { SearchHospitalSchema, SearchTestSchema } from "../types/UserSearch";

export const userBookingRouter=Router()


userBookingRouter.post("/search-by-hospital",async(req,res)=>{
    const hospital=SearchHospitalSchema.safeParse(req.body)
    if(!hospital.success){
        res.json({
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
        res.json({
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
    res.json({
        tests:tests
    })
})
userBookingRouter.post("/search-by-tests",async(req,res)=>{
    const testname=SearchTestSchema.safeParse(req.body)
    if(!testname.success){
        res.json({
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
    
    res.json({
        data
    })
})