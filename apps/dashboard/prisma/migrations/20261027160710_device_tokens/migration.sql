-- Device API auth (issue #21). Additive only: two nullable columns on each table.
-- Only SHA-256 hashes are stored; the enrollment key and device tokens never touch the database.

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "tokenHash" CHAR(64),
ADD COLUMN     "tokenIssuedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "enrollmentKeyCreatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "enrollmentKeyHash" CHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_enrollmentKeyHash_key" ON "Organization"("enrollmentKeyHash");

-- Hand-written CHECK constraints (Prisma can't express these): hashes are lowercase hex SHA-256.
ALTER TABLE "Device"
  ADD CONSTRAINT "Device_tokenHash_format" CHECK ("tokenHash" IS NULL OR "tokenHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_enrollmentKeyHash_format" CHECK ("enrollmentKeyHash" IS NULL OR "enrollmentKeyHash" ~ '^[0-9a-f]{64}$');
