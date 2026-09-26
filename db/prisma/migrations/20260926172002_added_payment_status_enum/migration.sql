/*
  Warnings:

  - Changed the type of `paymentStatus` on the `Booking` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('Success', 'Failed');

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "paymentStatus",
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL;
