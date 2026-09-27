-- DropIndex
DROP INDEX "Payment_bookingId_idx";

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "failureReason" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "eventID" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Webhook_eventID_key" ON "Webhook"("eventID");
