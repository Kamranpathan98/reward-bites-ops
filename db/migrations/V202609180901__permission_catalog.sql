-- Stage 1 (Implementation Blueprint section 5): permission table structure
-- only. Seeded by a later data-only migration
-- (V..._data_seed_permissions), not here.

CREATE TABLE permission (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL
);
