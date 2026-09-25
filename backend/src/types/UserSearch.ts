import { z } from "zod";

export const SearchHospitalSchema = z.object({
    hospital: z.string().trim().min(1)
});

export const SearchTestSchema = z.object({
    testname: z.string().trim().min(1)
});