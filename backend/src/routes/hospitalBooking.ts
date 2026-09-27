import { Router } from "express"
import { hospitalAuthMiddleware } from "../middleware/hospitalAuthMiddleware"

export const HospitalBooking=Router()

HospitalBooking.post("/add-test",hospitalAuthMiddleware,(req,res)=>{
    // CRUD EDNPOINT TO ADD A TEST
})
HospitalBooking.delete("/remove-test/:id",hospitalAuthMiddleware,(req,res)=>{
    // CRUD ENDPOINT TO DELETE A TEST
})
HospitalBooking.put("/update-test/:id",hospitalAuthMiddleware,(req,res)=>{
    // CRUD ENDPOINT TO UPDATE A DTEST
})