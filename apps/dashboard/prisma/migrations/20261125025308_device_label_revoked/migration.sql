-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "label" VARCHAR(64),
ADD COLUMN     "revokedAt" TIMESTAMPTZ(3);
