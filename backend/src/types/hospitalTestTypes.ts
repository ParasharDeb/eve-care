import { z } from "zod";

export const AddTestSchema = z.object({
    name: z.string().trim().min(1),
    price: z.number().int().positive()
});

export const UpdateTestSchema = z.object({
    name: z.string().trim().min(1).optional(),
    price: z.number().int().positive().optional()
});

export const TestIdSchema = z.uuid();
