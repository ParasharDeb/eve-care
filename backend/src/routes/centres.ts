import { Router } from "express"
import prisma from "@repo/db"
import { CentreIdSchema, ListCentresSchema } from "../types/centreTypes"

export const CentresRouter=Router()

// what anyone can see about a centre; email, password and tokens stay internal
const centreSelect={
    id:true,
    hopitalname:true,
    location:true
} as const

// public: browsing centres and their prices doesn't need an account, booking does
CentresRouter.get("/",async(req,res)=>{
    const parsed=ListCentresSchema.safeParse(req.query)
    if(!parsed.success){
        req.log.warn({ issues: parsed.error.issues.map(i=>i.path.join(".")) },"list centres validation failed")
        res.status(400).json({
            message:"page and limit must be positive numbers, limit at most 50"
        })
        return
    }
    const { page, limit, search, location }=parsed.data
    const where={
        ...(search ? { hopitalname:{ contains:search, mode:"insensitive" as const } } : {}),
        ...(location ? { location:{ contains:location, mode:"insensitive" as const } } : {})
    }

    try {
        // two independent reads, no transaction needed: a count that is off by one while a centre signs up is fine
        const [centres,total]=await Promise.all([
            prisma.hospital.findMany({
                where:where,
                select:{
                    ...centreSelect,
                    _count:{
                        select:{
                            Tests:true
                        }
                    }
                },
                orderBy:{
                    hopitalname:"asc"
                },
                skip:(page-1)*limit,
                take:limit
            }),
            prisma.hospital.count({
                where:where
            })
        ])
        req.log.info({ page, limit, results:centres.length, total },"list centres")
        res.json({
            centres,
            page,
            limit,
            total,
            totalPages:Math.ceil(total/limit)
        })
    } catch (error) {
        req.log.error({ err:error },"list centres failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})

CentresRouter.get("/:id",async(req,res)=>{
    const centreId=CentreIdSchema.safeParse(req.params.id)
    if(!centreId.success){
        req.log.warn("get centre: invalid centre id")
        res.status(400).json({
            message:"Invalid centre ID"
        })
        return
    }

    try {
        const centre=await prisma.hospital.findUnique({
            where:{
                id:centreId.data
            },
            select:{
                ...centreSelect,
                Tests:{
                    select:{
                        id:true,
                        name:true,
                        price:true
                    },
                    orderBy:{
                        name:"asc"
                    }
                }
            }
        })
        if(!centre){
            req.log.info({ centreId:centreId.data },"get centre: not found")
            res.status(404).json({
                message:"centre not found"
            })
            return
        }
        req.log.info({ centreId:centre.id, tests:centre.Tests.length },"get centre")
        res.json({
            centre
        })
    } catch (error) {
        req.log.error({ err:error, centreId:centreId.data },"get centre failed")
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})
