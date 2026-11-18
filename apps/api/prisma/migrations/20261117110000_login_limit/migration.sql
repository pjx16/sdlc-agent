CREATE TABLE "LoginLimit" (
    "key" TEXT NOT NULL,
    "failures" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "lockedUntil" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LoginLimit_pkey" PRIMARY KEY ("key")
);
