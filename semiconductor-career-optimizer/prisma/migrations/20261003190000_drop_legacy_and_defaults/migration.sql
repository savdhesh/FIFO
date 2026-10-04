-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_userId_fkey";

-- DropForeignKey
ALTER TABLE "CareerProfile" DROP CONSTRAINT "CareerProfile_userId_fkey";

-- AlterTable
ALTER TABLE "ResumeFile" ALTER COLUMN "rawText" SET DEFAULT '';

-- DropTable
DROP TABLE "Application";

-- DropTable
DROP TABLE "CareerProfile";

-- DropEnum
DROP TYPE "ApplicationStatus";

