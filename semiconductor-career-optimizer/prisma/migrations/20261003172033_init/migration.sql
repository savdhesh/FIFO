-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SAVED', 'ANALYZED', 'APPLYING', 'APPLIED', 'RECRUITER_CONTACTED', 'SCREENING', 'TECHNICAL_ROUND', 'HIRING_MANAGER', 'FINAL_ROUND', 'OFFER', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "roleTitle" TEXT NOT NULL DEFAULT '',
    "jobUrl" TEXT,
    "jdText" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "parsedJd" JSONB NOT NULL,
    "match" JSONB NOT NULL,
    "tailored" JSONB,
    "changes" JSONB,
    "coverLetter" JSONB,
    "truthAudit" JSONB,
    "matchScore" INTEGER NOT NULL,
    "recommendation" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'ANALYZED',
    "appliedAt" TIMESTAMP(3),
    "recruiterName" TEXT,
    "recruiterContact" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CareerProfile_userId_key" ON "CareerProfile"("userId");

-- CreateIndex
CREATE INDEX "ResumeFile_userId_idx" ON "ResumeFile"("userId");

-- CreateIndex
CREATE INDEX "Application_userId_createdAt_idx" ON "Application"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CareerProfile" ADD CONSTRAINT "CareerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeFile" ADD CONSTRAINT "ResumeFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
