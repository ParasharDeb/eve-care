import { Router } from "express";
import { SigninSchema, Signupschema } from "../types/userAuthTypes";
import bcrypt from "bcrypt"
import prisma from "@repo/db";
import jwt from "jsonwebtoken"
import { generateAccessToken, generateRefreshToken } from "../utils/tokens";
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

UserAuthRoter.post("/signin",async(req,res)=>{
    const parsed = SigninSchema.safeParse(req.body)
    if(!parsed.success){
        res.status(411).json({
            message:"fillup all input boxes"
        })
        return
    }
    const existinguser= await prisma.user.findFirst({
        where:{
            email:parsed.data.email
        }
    })
    if(!existinguser){
        res.status(411  ).json({
            message:"email doesnt exist"
        })
        return
    }
    const ispasswordcorrect = await bcrypt.compare(parsed.data.password,existinguser.password)
    if(!ispasswordcorrect){
        res.status(411).json({
            message:"Your password is incorrect"
        })
        return
    }
    const accessToken = generateAccessToken(existinguser.id);
    const refreshToken = generateRefreshToken(existinguser.id);
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    await prisma.user.update({
    where: { id: existinguser.id },
    data: {
      refreshtoken:refreshTokenHash,
    },
    });
    res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  return res.json({
    accessToken
  });
})

UserAuthRoter.post("/logout",async(req,res)=>{
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    try {
      const decoded = jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET!
      ) as { userId: string };

      await prisma.user.update({
        where: {
          id: decoded.userId,
        },
        data: {
          refreshTokenHash: null,
        },
      });
    } catch {
      res.json({
        message:"you are not signed int"
    })
    }
  }

  res.clearCookie("refreshToken");

  return res.json({
    message: "Logged out",
  });

})