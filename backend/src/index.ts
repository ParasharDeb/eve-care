import "dotenv/config"
import express, { type ErrorRequestHandler } from "express"
import cors from "cors"
import cookieParser from "cookie-parser"
import { UserAuthRoter } from "./routes/userAuth"
import { HospitalAuthRouter } from "./routes/hospitalAuth"
import { userBookingRouter } from "./routes/userBooking"
import { httpLogger, logger } from "./utils/logger"

const app=express()

app.use(httpLogger)
app.use(cors())
app.use(express.json())
app.use(cookieParser())

app.use("/api/user/auth",UserAuthRoter)
app.use("/api/hospital/auth",HospitalAuthRouter)
app.use("/api/user/booking",userBookingRouter)

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

const PORT = Number(process.env.PORT ?? 8080)
app.listen(PORT,()=>logger.info({ port:PORT },"server started"))
