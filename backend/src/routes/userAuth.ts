import { Router } from "express";
import { Signupschema } from "../types/userAuthTypes";
export const UserAuthRoter=Router()

UserAuthRoter.post("/signup",async(req,res)=>{
    const data = Signupschema.safeParse(req.body)
    if(!data){
        res.status(411).json({
            message:"fillup all the input boxes"
        })
        return;
    }
    
})