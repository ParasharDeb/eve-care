import express, { type ErrorRequestHandler } from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import { UserAuthRoter } from "./routes/userAuth"
import { HospitalAuthRouter } from "./routes/hospitalAuth"
import { userBookingRouter } from "./routes/userBooking"
import { httpLogger } from "./utils/logger"
import { PaymentRouter } from "./routes/userPayments"
import { HospitalBooking } from "./routes/hospitalBooking"
import { apiLimiter, authLimiter, paymentLimiter } from "./utils/rateLimit"

export const app=express()

app.use(httpLogger)
app.use(cors())
// keep the raw bytes too: the webhook signature is checked against exactly what the provider sent
app.use(express.json({ verify:(req,_res,buf)=>{ (req as { rawBody?: Buffer }).rawBody=buf } }))
app.use(cookieParser())

// rate limits. the webhook is left out on purpose: the payment provider must never be throttled
app.use("/api",apiLimiter)
app.use(["/api/user/auth/signin","/api/user/auth/signup","/api/hospital/auth/signin","/api/hospital/auth/signup"],authLimiter)
app.post("/payments",paymentLimiter)
app.get("/payments/:id",paymentLimiter)

app.use("/api/user/auth",UserAuthRoter)
app.use("/api/hospital/auth",HospitalAuthRouter)
app.use("/api/hospital/tests",HospitalBooking)
app.use("/api/user/booking",userBookingRouter)
app.use("/payments",PaymentRouter)
app.use((_req,res)=>{
    res.status(404).json({ message:"route not found" })
})

const errorHandler: ErrorRequestHandler = (err,req,res,_next)=>{
    if (err.type === "entity.parse.failed") {
        res.status(400).json({ message:"invalid JSON body" })
        return
    }
    req.log.error({ err },"unhandled error")
    res.status(500).json({ message:"Sorry the backend is down. Try again later" })
}
app.use(errorHandler)
