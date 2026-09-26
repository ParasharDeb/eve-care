import { z } from "zod";
export const BookingSchema = z.object({
  testid: z.string().min(1, "Test ID is required"),
  date: z.string().datetime(),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format"),
});