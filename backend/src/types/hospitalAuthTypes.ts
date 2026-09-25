import z from "zod"

export const HospitalSignupSchema=z.object({
    hospitalname:z.string(),
    email:z.string(),
    password:z.string(),
    location:z.string()
})

export const HospitalSigninSchema=z.object({
    email:z.string(),
    password:z.string()
})
