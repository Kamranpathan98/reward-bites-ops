-- Self-service onboarding (docs/IMPLEMENTATION_STATUS.md "Onboarding"
-- section). Pulls `public_rate_limit` forward from its originally planned
-- home at blueprint stage 9 (architecture section 9's table catalog:
-- "Order-placement throttle | key, window_start, count | no tenant_id;
-- pruned by cron") — its shape is generic enough to also arbitrate
-- POST /auth/signup abuse today, and Public Ordering (Gate 11) will reuse
-- the same table under a different key prefix rather than getting a
-- second one. No tenant_id, so it is NOT looped over by the dynamic
-- R__rls_policies.sql scan (same reasoning as login_attempt/platform_admin
-- already documented there) — RLS is not applicable to a table with no
-- tenant to isolate by.
--
-- `key` is the counter identity (e.g. 'signup:ip:1.2.3.4'), not a surrogate
-- id — one row per rate-limited subject, atomically upserted.
CREATE TABLE public_rate_limit (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INT NOT NULL DEFAULT 1
);
