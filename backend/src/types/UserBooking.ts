import { z } from "zod";
export const BookingSchema = z.object({
  testid: z.uuid("Test ID must be a valid UUID"),
  date: z.iso.datetime({ offset: true }),
});

export const BookingIdSchema = z.uuid();
