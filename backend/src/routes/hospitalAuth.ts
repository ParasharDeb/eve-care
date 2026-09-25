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
        res.status(411).json({
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
        res.status(411).json({
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
        res.status(411).json({
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
        res.json({
            message:hospital.id
        })
    } catch (error) {
        console.log(error)
        res.status(500).json({
            message:"Sorry the backend is down. Try again later"
        })
    }
})

HospitalAuthRouter.post("/signin",async(req,res)=>{
    const parsed = HospitalSigninSchema.safeParse(req.body)
    if(!parsed.success){
        res.status(411).json({
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
        res.status(411).json({
            message:"email doesnt exist"
        })
        return
    }
    const ispasswordcorrect = await bcrypt.compare(parsed.data.password,hospital.password)
    if(!ispasswordcorrect){
        res.status(411).json({
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

    return res.json({
        accessToken
    });
})

HospitalAuthRouter.post("/refresh",async (req,res)=>{
    const refreshToken = req.cookies[process.env.REFRESH_COOKIE!];

    if (!refreshToken) {
        return res.status(401).json({
            message: "No refresh token",
        });
    }

    try {
        const decoded = jwt.verify(
            refreshToken,
            process.env.REFRESH_TOKEN_SECRET!
        ) as { userId: string };

        const hospital = await prisma.hospital.findUnique({
            where: {
                id: decoded.userId,
            },
        });

        if (!hospital || !hospital.refrestoken || hashToken(refreshToken) !== hospital.refrestoken) {
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

        return res.json({
            accessToken: newAccessToken,
        });

    } catch {
        return res.status(401).json({
            message: "Invalid or expired refresh token",
        });
    }
})

HospitalAuthRouter.post("/logout",async(req,res)=>{
    const refreshToken = req.cookies[process.env.REFRESH_COOKIE!];

    if (refreshToken) {
        try {
            const decoded = jwt.verify(
                refreshToken,
                process.env.REFRESH_TOKEN_SECRET!
            ) as { userId: string };

            await prisma.hospital.update({
                where: {
                    id: decoded.userId,
                },
                data: {
                    refrestoken: "",
                },
            });
        } catch {
            res.clearCookie(process.env.REFRESH_COOKIE!);
            return res.status(401).json({
                message:"you are not signed in"
            })
        }
    }

    res.clearCookie(process.env.REFRESH_COOKIE!);

    return res.json({
        message: "Logged out",
    });
})
