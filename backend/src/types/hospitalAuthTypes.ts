import z from "zod"

export const HospitalSignupSchema=z.object({
    hospitalname:z.string().trim().min(1),
    email:z.email(),
    password:z.string().min(8),
    location:z.string().trim().min(1)
})

// signin only checks the shape; a wrong password is a 401, not a 400
export const HospitalSigninSchema=z.object({
    email:z.email(),
    password:z.string().min(1)
})
