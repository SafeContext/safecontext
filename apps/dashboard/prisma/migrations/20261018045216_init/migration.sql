-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('green', 'yellow', 'red');

-- CreateEnum
CREATE TYPE "Action" AS ENUM ('allow', 'generalize', 'pseudonymize', 'mask', 'block');

-- CreateEnum
CREATE TYPE "FailMode" AS ENUM ('block', 'allow');

-- CreateEnum
CREATE TYPE "HookEventName" AS ENUM ('UserPromptSubmit', 'PreToolUse', 'PostToolUse');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "failMode" "FailMode" NOT NULL DEFAULT 'block',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataType" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "examples" TEXT[],
    "tier" "Tier" NOT NULL,
    "action" "Action" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DataType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermList" (
    "id" UUID NOT NULL,
    "dataTypeId" UUID NOT NULL,
    "terms" TEXT[],
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TermList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "failMode" "FailMode" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" VARCHAR(64) NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPolicyVersion" INTEGER,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "policyVersion" INTEGER NOT NULL,
    "hookEvent" "HookEventName" NOT NULL,
    "toolName" VARCHAR(128),
    "blocked" BOOLEAN NOT NULL,
    "latencyMs" DOUBLE PRECISION NOT NULL,
    "actionAllow" INTEGER NOT NULL DEFAULT 0,
    "actionGeneralize" INTEGER NOT NULL DEFAULT 0,
    "actionPseudonymize" INTEGER NOT NULL DEFAULT 0,
    "actionMask" INTEGER NOT NULL DEFAULT 0,
    "actionBlock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCount" (
    "eventId" UUID NOT NULL,
    "dataTypeKey" VARCHAR(64) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "EventCount_pkey" PRIMARY KEY ("eventId","dataTypeKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Member_userId_key" ON "Member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_organizationId_email_key" ON "Member"("organizationId", "email");

-- CreateIndex
CREATE INDEX "DataType_organizationId_tier_position_idx" ON "DataType"("organizationId", "tier", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DataType_organizationId_key_key" ON "DataType"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "TermList_dataTypeId_key" ON "TermList"("dataTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_organizationId_version_key" ON "PolicyVersion"("organizationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Device_organizationId_deviceId_key" ON "Device"("organizationId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_organizationId_id_key" ON "Device"("organizationId", "id");

-- CreateIndex
CREATE INDEX "Event_organizationId_ts_idx" ON "Event"("organizationId", "ts" DESC);

-- CreateIndex
CREATE INDEX "Event_deviceId_ts_idx" ON "Event"("deviceId", "ts" DESC);

-- CreateIndex
CREATE INDEX "EventCount_dataTypeKey_idx" ON "EventCount"("dataTypeKey");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataType" ADD CONSTRAINT "DataType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermList" ADD CONSTRAINT "TermList_dataTypeId_fkey" FOREIGN KEY ("dataTypeId") REFERENCES "DataType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizationId_deviceId_fkey" FOREIGN KEY ("organizationId", "deviceId") REFERENCES "Device"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCount" ADD CONSTRAINT "EventCount_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written CHECK constraints (Prisma can't express these). They mirror packages/policy so bad
-- rows are rejected even if a code path skips Zod validation.
-- Id-shaped strings: lowercase kebab-case, as in the policy `Id` schema.
ALTER TABLE "DataType"
  ADD CONSTRAINT "DataType_key_format" CHECK ("key" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  -- Policy rule: only green data types use "allow", and every green one must.
  ADD CONSTRAINT "DataType_green_iff_allow" CHECK (("tier" = 'green') = ("action" = 'allow'));

ALTER TABLE "Device"
  ADD CONSTRAINT "Device_deviceId_format" CHECK ("deviceId" ~ '^[a-z0-9][a-z0-9-]{0,63}$');

-- Events hold metadata only: these keep the few string columns id-shaped and the numbers sane.
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_toolName_format" CHECK ("toolName" IS NULL OR "toolName" ~ '^[A-Za-z0-9_-]{1,128}$'),
  ADD CONSTRAINT "Event_numbers_nonnegative" CHECK (
    "policyVersion" >= 0 AND "latencyMs" >= 0 AND
    "actionAllow" >= 0 AND "actionGeneralize" >= 0 AND "actionPseudonymize" >= 0 AND
    "actionMask" >= 0 AND "actionBlock" >= 0
  );

ALTER TABLE "EventCount"
  ADD CONSTRAINT "EventCount_dataTypeKey_format" CHECK ("dataTypeKey" ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  ADD CONSTRAINT "EventCount_count_nonnegative" CHECK ("count" >= 0);

ALTER TABLE "PolicyVersion"
  ADD CONSTRAINT "PolicyVersion_version_positive" CHECK ("version" >= 1);
