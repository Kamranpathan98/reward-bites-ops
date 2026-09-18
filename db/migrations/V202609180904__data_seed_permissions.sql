-- Stage 13 (Implementation Blueprint section 5): "Insert the full
-- permission catalog rows." Data-only, never mixed with DDL.
--
-- Every key below is taken verbatim from the locked V1 Architecture's API
-- endpoint catalog (section 12, the bracketed `[permission]` on each
-- route) and actors table (section 3). Seeding the whole catalog now,
-- ahead of the modules that will enforce most of them, matches the
-- architecture's own intent (system roles in section 3 are already
-- defined in terms of the full set, e.g. Cashier = "orders.*, bills.*,
-- payments.*, ..."). No code in this gate enforces anything beyond
-- tenant.read/update and users.read/manage — the rest are inert catalog
-- rows until their owning module's guards ship.
INSERT INTO permission (key, description) VALUES
  ('tenant.read', 'Read the current tenant''s profile'),
  ('tenant.update', 'Update the current tenant''s profile'),
  ('tenant.delete', 'Delete the current tenant (owner only; no endpoint yet)'),
  ('settings.read', 'Read tenant settings'),
  ('settings.update', 'Update tenant settings'),
  ('settings.payments.manage', 'Update payment-related settings (UPI id, payment toggles)'),
  ('users.read', 'List tenant users, memberships, roles, and permissions'),
  ('users.manage', 'Invite users, change roles/status, revoke sessions'),
  ('tables.read', 'Read tables and their QR assets'),
  ('tables.manage', 'Create/update/delete tables, regenerate QR tokens'),
  ('sessions.read', 'Read table sessions'),
  ('sessions.close', 'Force-close a table session'),
  ('menu.read', 'Read the full menu tree, including inactive items'),
  ('menu.manage', 'Create/update/delete menu categories, items, variants, add-ons'),
  ('menu.availability.update', 'Toggle item/variant availability'),
  ('orders.read', 'Read orders'),
  ('orders.create', 'Create an order at the counter'),
  ('orders.update', 'Edit an order''s lines while NEW/ACCEPTED'),
  ('orders.update.in_progress', 'Edit an order''s lines while PREPARING/READY, with a reason'),
  ('orders.transition.front', 'Transition an order through front-of-house states'),
  ('orders.transition.kitchen', 'Transition an order through kitchen states'),
  ('orders.cancel', 'Cancel an order with a reason'),
  ('orders.reopen', 'Reopen a completed, unbilled order'),
  ('kitchen.read', 'Read the kitchen display order queue'),
  ('bills.read', 'Read bills'),
  ('bills.create', 'Create a draft bill, or discard one'),
  ('bills.discount', 'Apply a discount to a draft bill'),
  ('bills.finalize', 'Finalize a draft bill'),
  ('bills.void', 'Void a finalized bill'),
  ('payments.read', 'Read payments for a bill'),
  ('payments.record', 'Record a payment against a bill'),
  ('expenses.read', 'Read expenses and expense categories'),
  ('expenses.manage', 'Create/update/delete expenses and expense categories'),
  ('dashboard.read', 'Read dashboard summary and breakdown metrics'),
  ('audit.read', 'Read the audit log')
ON CONFLICT (key) DO NOTHING;
