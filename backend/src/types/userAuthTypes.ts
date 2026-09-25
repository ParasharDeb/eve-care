import z from "zod"

export const Signupschema=z.object({
    username:z.string(),
    email:z.email(),
    password:z.string()
})

export const SigninSchema=z.object({
    email:z.email(),
    password:z.string()
})