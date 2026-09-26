import { Router } from "express";
import prisma from "@repo/db";
import { SearchHospitalSchema, SearchTestSchema } from "../types/UserSearch";
import { BookingSchema } from "../types/UserBooking";
import { userAuthMiddleware } from "../middleware/userAuthMiddleware";
import type { UserRequest } from "../middleware/userAuthMiddleware";

export const userBookingRouter=Router()


userBookingRouter.post("/search-by-hospital",userAuthMiddleware,async(req,res)=>{
    const hospital=SearchHospitalSchema.safeParse(req.body)
    if(!hospital.success){
        req.log.warn("search-by-hospital validation failed")
        res.status(400).json({
            message:"enter a valid hospital name"
        })
        return
    }

    const data= await prisma.hospital.findFirst({
        where:{
            hopitalname:{
                equals:hospital.data.hospital,
                mode: "insensitive"
            }
        }
    })
    if(!data){
        req.log.info({ query:hospital.data.hospital },"search-by-hospital: no match")
        res.status(404).json({
            message:"this hospital is not in our database"
        })
        return
    }
    const hospitalId=data.id
    const tests= await prisma.test.findMany({
        where:{
            hospitalId:hospitalId
        }
    })
    req.log.info({ hospitalId, results:tests.length },"search-by-hospital")
    res.json({
        tests:tests
    })
})
userBookingRouter.post("/search-by-tests",userAuthMiddleware,async(req,res)=>{
    const testname=SearchTestSchema.safeParse(req.body)
    if(!testname.success){
        req.log.warn("search-by-tests validation failed")
        res.status(400).json({
            message:"enter a valid test name"
        })
        return
    }
    const data = await prisma.test.findMany({
    where: {
        name: {
        equals:testname.data.testname,
        mode: "insensitive"}
    },
    select: {
        name: true,
        price: true,
        hospital: {
            select: {
                id: true,
                hopitalname: true,
                location: true
            }
        }
    }
    })

    req.log.info({ query:testname.data.testname, results:data.length },"search-by-tests")
    res.json({
        data
    })
})
userBookingRouter.post("/book-test",userAuthMiddleware,async (req: UserRequest, res) => {
    const parsed = BookingSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn("book-test validation failed");
      return res.status(400).json({
        message: "Invalid test ID",
      });
    }

    const userId = req.user!.id;
    const testId = parsed.data.testid;

    try {
      const test = await prisma.test.findUnique({
        where: { id: testId },
      });

      if (!test) {
        req.log.info({ testId }, "book-test: test not found");
        return res.status(404).json({
          message: "Test not found",
        });
      }

      const existingBooking = await prisma.booking.findFirst({
        where: {
          userId,
          testId,
          status: {
            in: ["Pending", "Confirmed"],
          },
        },
      });

      if (existingBooking) {
        req.log.warn({ userId, testId }, "book-test: duplicate booking attempt");
        return res.status(409).json({
          message: "You have already booked this test",
        });
      }

      const bookingDate = new Date(parsed.data.date);
      const [hours, minutes] = parsed.data.time.split(":").map(Number);
      const bookingTime = new Date(bookingDate);
      bookingTime.setHours(hours!, minutes, 0, 0);

      const booking = await prisma.booking.create({
        data: {
          userId,
          testId,
          date: bookingDate,
          time: bookingTime,
          status: "Pending",
          paymentStatus: "Pending",
        },
      });

      req.log.info({ userId, testId, bookingId: booking.id }, "test booked");
      return res.status(201).json({
        message: "Test booked successfully",
        booking,
      });
    } catch (error) {
      req.log.error({ userId, testId, error }, "book-test error");
      return res.status(500).json({
        message: "Failed to book test",
      });
    }
  }
);