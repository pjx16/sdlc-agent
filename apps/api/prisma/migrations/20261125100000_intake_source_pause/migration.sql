ALTER TABLE "GlobalSettings" ADD COLUMN "pausedIntakeSources" "TicketSource"[] NOT NULL DEFAULT ARRAY[]::"TicketSource"[];
