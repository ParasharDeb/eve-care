import { Router } from "express";
import { Signupschema } from "../types/userAuthTypes";
import bcrypt from "bcrypt"
import prisma from "@repo/db";
export const UserAuthRoter=Router()

UserAuthRoter.post("/signup",async(req,res)=>{
    const parsed = Signupschema.safeParse(req.body)
    if(!parsed.success){
        res.status(411).json({
            message:"fillup all the input boxes"
        })
        return;
    }
    const emailExists=await prisma.user.findFirst({
        where:{
            email:parsed.data.email
        }
    })
    if(emailExists){
        res.status(411).json({
            message:"This email is already in use. use another email"
        })
        return;
    }
    const hashedpassword= await bcrypt.hash(parsed.data.password,10)
    try {
        const user = await prisma.user.create({
            data:{
                username:parsed.data.username,
                email:parsed.data.email,
                password:hashedpassword,
                createdAt:new Date()
            }
        })
        
    res.json({
        message:user.id
    })
    } catch (error) {   
        console.log(error)
        res.status(404).json({
            message:"Sorry the backend is down. Try again alter"
        })
    }
})