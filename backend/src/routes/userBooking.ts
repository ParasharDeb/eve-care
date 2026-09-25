import { Router } from "express";
import prisma from "@repo/db";
export const userBookingRouter=Router()

userBookingRouter.post("/search-by-hospital",async(req,res)=>{
    const hospital=req.body.hospital
    const data= await prisma.hospital.findFirst({
        where:{
            hopitalname:hospital
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
    const testname=req.body.testname;
    const data = await prisma.test.findMany({
    where: {
        name: testname
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