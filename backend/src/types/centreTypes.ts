import { z } from "zod";

// query params always arrive as strings, so coerce page and limit to numbers
export const ListCentresSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(50).default(10),
    search: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional()
});

export const CentreIdSchema = z.uuid();
