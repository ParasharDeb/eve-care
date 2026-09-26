import {z} from "zod"
export const paymentTypes=z.object({
    amount:z.number(),
    
})