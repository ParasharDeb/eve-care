-- CreateTable
CREATE TABLE "Hospital" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hopitalname" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "refrestoken" TEXT NOT NULL,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Test" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "hospitalId" TEXT NOT NULL,

    CONSTRAINT "Test_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_email_key" ON "Hospital"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_hopitalname_key" ON "Hospital"("hopitalname");

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
