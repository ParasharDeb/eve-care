-- null now means "no active session" instead of the ' ' / '' placeholders
ALTER TABLE "User" ALTER COLUMN "refreshtoken" DROP NOT NULL,
ALTER COLUMN "refreshtoken" DROP DEFAULT;

UPDATE "User" SET "refreshtoken" = NULL WHERE trim("refreshtoken") = '';
