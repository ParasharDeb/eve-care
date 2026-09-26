import { Router } from "express";
import { SigninSchema, Signupschema } from "../types/userAuthTypes";
import bcrypt from "bcrypt"
import prisma from "@repo/db";
import jwt from "jsonwebtoken"
import { generateAccessToken, generateRefreshToken, hashToken } from "../utils/tokens";
export const UserAuthRoter=Router()
UserAuthRoter.post("/signup",async(req,res)=>{
    const parsed = Signupschema.safeParse(req.body)
    if(!parsed.success){
        req.log.warn({ issues: parsed.error.issues.map(i=>i.path.join(".")) },"user signup validation failed")
        res.status(400).json({
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
        req.log.warn("user signup rejected: email already in use")
        res.status(409).json({
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
        req.log.info({ userId:user.id },"user signed up")
        res.status(201).json({
            message:user.id
        })
    } catch (error) {
        // concurrent signup with the same email
        if ((error as { code?: string }).code === "P2002") {
            res.status(409).json({
                message:"This email is already in use. use another email"
            })
            return
        }
        throw error
    }
})

UserAuthRoter.post("/signin",async(req,res)=>{
    const parsed = SigninSchema.safeParse(req.body)
    if(!parsed.success){
        req.log.warn({ issues: parsed.error.issues.map(i=>i.path.join(".")) },"user signin validation failed")
        res.status(400).json({
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
        req.log.warn({ reason:"unknown_email" },"user signin failed")
        res.status(401).json({
            message:"email doesnt exist"
        })
        return
    }
    const ispasswordcorrect = await bcrypt.compare(parsed.data.password,existinguser.password)
    if(!ispasswordcorrect){
        req.log.warn({ reason:"wrong_password", userId:existinguser.id },"user signin failed")
        res.status(401).json({
            message:"Your password is incorrect"
        })
        return
    }
    const accessToken = generateAccessToken(existinguser.id);
    const refreshToken = generateRefreshToken(existinguser.id);
    const refreshTokenHash = hashToken(refreshToken);

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

  req.log.info({ userId:existinguser.id },"user signed in")
  return res.json({
    accessToken
  });
})

UserAuthRoter.post("/refresh",async (req,res)=>{
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    req.log.warn({ reason:"no_cookie" },"user refresh failed")
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
    req.log.warn({ reason:"invalid_or_expired_jwt" },"user refresh failed")
    return res.status(401).json({
      message: "Invalid or expired refresh token",
    });
  }

  const user = await prisma.user.findUnique({
    where: {
      id: decoded.userId,
    },
  });

  if (!user || !user.refreshtoken || hashToken(refreshToken) !== user.refreshtoken) {
    req.log.warn({ reason: user ? "token_not_current" : "user_not_found", userId:decoded.userId },"user refresh failed")
    return res.status(401).json({
      message: "Invalid refresh token",
    });
  }

  const newAccessToken =
    generateAccessToken(user.id);

  const newRefreshToken =
    generateRefreshToken(user.id);

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      refreshtoken: hashToken(newRefreshToken),
    },
  });

  res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  req.log.info({ userId:user.id },"user token refreshed")
  return res.json({
    accessToken: newAccessToken,
  });
}
)

UserAuthRoter.post("/logout",async(req,res)=>{
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    let decoded: { userId: string };
    try {
      decoded = jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET!
      ) as { userId: string };
    } catch {
      req.log.warn({ reason:"invalid_or_expired_jwt" },"user logout failed")
      res.clearCookie("refreshToken");
      return res.status(401).json({
        message:"you are not signed in"
      })
    }

    // updateMany doesn't throw if the user was deleted
    await prisma.user.updateMany({
      where: {
        id: decoded.userId,
      },
      data: {
        refreshtoken: "",
      },
    });
    req.log.info({ userId:decoded.userId },"user logged out")
  }

  res.clearCookie("refreshToken");

  return res.json({
    message: "Logged out",
  });

})
