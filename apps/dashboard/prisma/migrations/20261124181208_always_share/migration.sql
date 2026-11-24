-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "allowTerms" TEXT[] DEFAULT ARRAY[]::TEXT[];
