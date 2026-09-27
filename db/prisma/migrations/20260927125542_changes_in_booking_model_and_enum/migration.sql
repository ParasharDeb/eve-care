/*
  Warnings:

  - You are about to drop the column `time` on the `Booking` table. All the data in the column will be lost.
  - Added the required column `price` to the `Booking` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'Refunded';

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "time",
ADD COLUMN     "price" INTEGER NOT NULL;
