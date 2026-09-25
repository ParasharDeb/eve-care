import z from "zod"

export const Signupschema=z.object({
    username:z.string(),
    email:z.string(),
    password:z.string()
})

export const SigninSchema=z.object({
    email:z.string(),
    password:z.string()
})