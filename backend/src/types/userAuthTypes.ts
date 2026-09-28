import z from "zod"

export const Signupschema=z.object({
    username:z.string().trim().min(1),
    email:z.email(),
    password:z.string().min(8)
})

// signin only checks the shape; a wrong password is a 401, not a 400
export const SigninSchema=z.object({
    email:z.email(),
    password:z.string().min(1)
})
