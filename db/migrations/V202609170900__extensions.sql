-- Stage 0 (Implementation Blueprint section 5).
-- pg_trgm backs trigram search on customer_name / order_number, needed
-- starting the orders module (Phase 5) — enabled now so no later migration
-- needs superuser-only privileges Flyway's app_migrator doesn't have.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
