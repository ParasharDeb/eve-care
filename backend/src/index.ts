import "dotenv/config"
import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import { UserAuthRoter } from "./routes/userAuth"
import { HospitalAuthRouter } from "./routes/hospitalAuth"
import { userBookingRouter } from "./routes/userBooking"

const app=express()

app.use(cors())
app.use(express.json())
app.use(cookieParser())

app.use("/api/user/auth",UserAuthRoter)
app.use("/api/hospital/auth",HospitalAuthRouter)
app.use("/api/user/booking",userBookingRouter)
app.listen(8080)