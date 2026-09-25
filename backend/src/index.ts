import "dotenv/config"
import express from "express"
import cors from "cors"
import { UserAuthRoter } from "./routes/userAuth"
import prisma from "@repo/db"
const app=express()
app.use(cors())

app.use("/api/user/auth",UserAuthRoter)

app.post("/health",async (req,res)=>{
    const data = await prisma.user.findFirst()
})
app.listen(8080)