-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "shellSkills" TEXT[] DEFAULT ARRAY[]::TEXT[];
