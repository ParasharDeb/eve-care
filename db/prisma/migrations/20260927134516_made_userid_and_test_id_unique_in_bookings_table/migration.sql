/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[testId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Booking_userId_key" ON "Booking"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_testId_key" ON "Booking"("testId");
