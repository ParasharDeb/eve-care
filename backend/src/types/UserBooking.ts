import { z } from "zod";
export const BookingSchema = z.object({
  testid: z.string().min(1, "Test ID is required"),
  date: z.string().datetime(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:MM format"),
});