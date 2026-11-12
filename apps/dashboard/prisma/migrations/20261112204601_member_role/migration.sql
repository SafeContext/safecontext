-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('admin', 'viewer');

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "role" "MemberRole" NOT NULL DEFAULT 'admin';
