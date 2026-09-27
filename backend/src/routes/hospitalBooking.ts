import { Router } from "express"
import prisma from "@repo/db"
import { hospitalAuthMiddleware, type HospitalRequest } from "../middleware/hospitalAuthMiddleware"
import { AddTestSchema, TestIdSchema, UpdateTestSchema } from "../types/hospitalTestTypes"

export const HospitalBooking=Router()

HospitalBooking.get("/my-tests",hospitalAuthMiddleware,async(req:HospitalRequest,res)=>{
    const hospitalId=req.hospital!.id

    try {
        const tests=await prisma.test.findMany({
            where:{
                hospitalId:hospitalId
            }
        })
        req.log.info({ hospitalId, results:tests.length },"list hospital tests")
        res.json({
            tests
        })
    } catch (error) {
        req.log.error({ err:error, hospitalId },"list hospital tests failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})

HospitalBooking.post("/add-test",hospitalAuthMiddleware,async(req:HospitalRequest,res)=>{
    const parsed=AddTestSchema.safeParse(req.body)
    if(!parsed.success){
        req.log.warn("add-test validation failed")
        res.status(400).json({
            message:"enter a test name and a price"
        })
        return
    }
    const hospitalId=req.hospital!.id

    try {
        const test=await prisma.test.create({
            data:{
                name:parsed.data.name,
                price:parsed.data.price,
                hospitalId:hospitalId
            }
        })
        req.log.info({ hospitalId, testId:test.id },"test added")
        res.status(201).json({
            test
        })
    } catch (error) {
        req.log.error({ err:error, hospitalId },"add-test failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})

HospitalBooking.put("/update-test/:id",hospitalAuthMiddleware,async(req:HospitalRequest,res)=>{
    const testId=TestIdSchema.safeParse(req.params.id)
    if(!testId.success){
        req.log.warn("update-test: invalid test id")
        res.status(400).json({
            message:"Invalid test ID"
        })
        return
    }
    const parsed=UpdateTestSchema.safeParse(req.body)
    if(!parsed.success){
        req.log.warn("update-test validation failed")
        res.status(400).json({
            message:"enter a valid test name or price"
        })
        return
    }
    const hospitalId=req.hospital!.id

    try {
        // a hospital can only change its own tests
        const test=await prisma.test.findFirst({
            where:{
                id:testId.data,
                hospitalId:hospitalId
            }
        })
        if(!test){
            req.log.info({ hospitalId, testId:testId.data },"update-test: test not found")
            res.status(404).json({
                message:"test not found"
            })
            return
        }
        const updatedTest=await prisma.test.update({
            where:{
                id:test.id
            },
            data:{
                name:parsed.data.name,
                price:parsed.data.price
            }
        })
        req.log.info({ hospitalId, testId:test.id },"test updated")
        res.json({
            test:updatedTest
        })
    } catch (error) {
        req.log.error({ err:error, hospitalId, testId:testId.data },"update-test failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})

HospitalBooking.delete("/remove-test/:id",hospitalAuthMiddleware,async(req:HospitalRequest,res)=>{
    const testId=TestIdSchema.safeParse(req.params.id)
    if(!testId.success){
        req.log.warn("remove-test: invalid test id")
        res.status(400).json({
            message:"Invalid test ID"
        })
        return
    }
    const hospitalId=req.hospital!.id

    try {
        // a hospital can only delete its own tests
        const test=await prisma.test.findFirst({
            where:{
                id:testId.data,
                hospitalId:hospitalId
            }
        })
        if(!test){
            req.log.info({ hospitalId, testId:testId.data },"remove-test: test not found")
            res.status(404).json({
                message:"test not found"
            })
            return
        }
        const bookings=await prisma.booking.count({
            where:{
                testId:test.id
            }
        })
        if(bookings>0){
            req.log.warn({ hospitalId, testId:test.id, bookings },"remove-test rejected: test has bookings")
            res.status(409).json({
                message:"this test has bookings and cannot be deleted"
            })
            return
        }
        await prisma.test.delete({
            where:{
                id:test.id
            }
        })
        req.log.info({ hospitalId, testId:test.id },"test removed")
        res.json({
            message:"test removed"
        })
    } catch (error) {
        req.log.error({ err:error, hospitalId, testId:testId.data },"remove-test failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})
