import { Router } from "express";
import { HospitalSigninSchema, HospitalSignupSchema } from "../types/hospitalAuthTypes";
import bcrypt from "bcrypt"
import prisma from "@repo/db";
import jwt from "jsonwebtoken"
import { generateAccessToken, generateRefreshToken, hashToken } from "../utils/tokens";
export const HospitalAuthRouter=Router()

const cookieOptions={
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 30 * 24 * 60 * 60 * 1000,
}

HospitalAuthRouter.post("/signup",async(req,res)=>{
    const parsed = HospitalSignupSchema.safeParse(req.body)
    if(!parsed.success){
        req.log.warn({ issues: parsed.error.issues.map(i=>i.path.join(".")) },"hospital signup validation failed")
        res.status(400).json({
            message:"fillup all the input boxes"
        })
        return;
    }
    const emailExists=await prisma.hospital.findUnique({
        where:{
            email:parsed.data.email
        }
    })
    if(emailExists){
        req.log.warn("hospital signup rejected: email already in use")
        res.status(409).json({
            message:"This email is already in use. use another email"
        })
        return;
    }
    const nameExists=await prisma.hospital.findUnique({
        where:{
            hopitalname:parsed.data.hospitalname
        }
    })
    if(nameExists){
        req.log.warn("hospital signup rejected: name already registered")
        res.status(409).json({
            message:"A hospital with this name is already registered"
        })
        return;
    }
    const hashedpassword= await bcrypt.hash(parsed.data.password,10)
    try {
        const hospital = await prisma.hospital.create({
            data:{
                hopitalname:parsed.data.hospitalname,
                email:parsed.data.email,
                password:hashedpassword,
                location:parsed.data.location,
                refrestoken:""
            }
        })
        req.log.info({ hospitalId:hospital.id },"hospital signed up")
        res.status(201).json({
            message:hospital.id
        })
    } catch (error) {
        // concurrent signup with the same email or name
        if ((error as { code?: string }).code === "P2002") {
            res.status(409).json({
                message:"This email or hospital name is already registered"
            })
            return
        }
        throw error
    }
})

HospitalAuthRouter.post("/signin",async(req,res)=>{
    const parsed = HospitalSigninSchema.safeParse(req.body)
    if(!parsed.success){
        req.log.warn({ issues: parsed.error.issues.map(i=>i.path.join(".")) },"hospital signin validation failed")
        res.status(400).json({
            message:"fillup all input boxes"
        })
        return
    }
    const hospital= await prisma.hospital.findUnique({
        where:{
            email:parsed.data.email
        }
    })
    if(!hospital){
        req.log.warn({ reason:"unknown_email" },"hospital signin failed")
        res.status(401).json({
            message:"email doesnt exist"
        })
        return
    }
    const ispasswordcorrect = await bcrypt.compare(parsed.data.password,hospital.password)
    if(!ispasswordcorrect){
        req.log.warn({ reason:"wrong_password", hospitalId:hospital.id },"hospital signin failed")
        res.status(401).json({
            message:"Your password is incorrect"
        })
        return
    }
    const accessToken = generateAccessToken(hospital.id);
    const refreshToken = generateRefreshToken(hospital.id);

    await prisma.hospital.update({
        where: { id: hospital.id },
        data: {
            refrestoken:hashToken(refreshToken),
        },
    });
    res.cookie(process.env.REFRESH_COOKIE!, refreshToken, cookieOptions);

    req.log.info({ hospitalId:hospital.id },"hospital signed in")
    return res.json({
        accessToken
    });
})

HospitalAuthRouter.post("/refresh",async (req,res)=>{
    const refreshToken = req.cookies[process.env.REFRESH_COOKIE!];

    if (!refreshToken) {
        req.log.warn({ reason:"no_cookie" },"hospital refresh failed")
        return res.status(401).json({
            message: "No refresh token",
        });
    }

    let decoded: { userId: string };
    try {
        decoded = jwt.verify(
            refreshToken,
            process.env.REFRESH_TOKEN_SECRET!
        ) as { userId: string };
    } catch {
        req.log.warn({ reason:"invalid_or_expired_jwt" },"hospital refresh failed")
        return res.status(401).json({
            message: "Invalid or expired refresh token",
        });
    }

    const hospital = await prisma.hospital.findUnique({
        where: {
            id: decoded.userId,
        },
    });

    if (!hospital || !hospital.refrestoken || hashToken(refreshToken) !== hospital.refrestoken) {
        req.log.warn({ reason: hospital ? "token_not_current" : "hospital_not_found", hospitalId:decoded.userId },"hospital refresh failed")
        return res.status(401).json({
            message: "Invalid refresh token",
        });
    }

    const newAccessToken = generateAccessToken(hospital.id);
    const newRefreshToken = generateRefreshToken(hospital.id);

    await prisma.hospital.update({
        where: {
            id: hospital.id,
        },
        data: {
            refrestoken: hashToken(newRefreshToken),
        },
    });

    res.cookie(process.env.REFRESH_COOKIE!, newRefreshToken, cookieOptions);

    req.log.info({ hospitalId:hospital.id },"hospital token refreshed")
    return res.json({
        accessToken: newAccessToken,
    });
})

HospitalAuthRouter.post("/logout",async(req,res)=>{
    const refreshToken = req.cookies[process.env.REFRESH_COOKIE!];

    if (refreshToken) {
        let decoded: { userId: string };
        try {
            decoded = jwt.verify(
                refreshToken,
                process.env.REFRESH_TOKEN_SECRET!
            ) as { userId: string };
        } catch {
            req.log.warn({ reason:"invalid_or_expired_jwt" },"hospital logout failed")
            res.clearCookie(process.env.REFRESH_COOKIE!);
            return res.status(401).json({
                message:"you are not signed in"
            })
        }

        // updateMany doesn't throw if the hospital was deleted
        await prisma.hospital.updateMany({
            where: {
                id: decoded.userId,
            },
            data: {
                refrestoken: "",
            },
        });
        req.log.info({ hospitalId:decoded.userId },"hospital logged out")
    }

    res.clearCookie(process.env.REFRESH_COOKIE!);

    return res.json({
        message: "Logged out",
    });
})
