import "dotenv/config"
import express from "express"
import cors from "cors"
import { UserAuthRoter } from "./routes/userAuth"

const app=express()

app.use(cors())
app.use(express.json())

app.use("/api/user/auth",UserAuthRoter)

app.listen(8080)