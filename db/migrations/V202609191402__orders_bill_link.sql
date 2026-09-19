-- Gate 8 (Implementation Blueprint section 5, stage 6 `orders_bill_link`):
-- closes the orders <-> bill forward-reference cycle by adding the one
-- column V202609182000__orders_core.sql deliberately left out.
--
-- `orders.bill_id` is the AUTHORITATIVE current billing relationship
-- (architecture section 8): NULL = unbilled. It is set only by bill
-- finalization and cleared only by bill void, inside those transactions
-- (enforced by trg orders_billed_guard in R__triggers.sql). bill_order is the
-- historical association and is never consulted for "current bill".

ALTER TABLE orders ADD COLUMN bill_id UUID;

ALTER TABLE orders
  ADD CONSTRAINT orders_tenant_bill_fk
  FOREIGN KEY (tenant_id, bill_id) REFERENCES bill (tenant_id, id);

-- Reverse composite FK (MATCH SIMPLE — skipped while bill_id IS NULL). It
-- enforces one direction of the agreement invariant at the database level:
--   orders.bill_id = X  =>  the order is a member of bill X in bill_order.
-- The other direction (every member of a FINALIZED bill points back at it) is
-- asserted by the bill guard on the DRAFT -> FINALIZED edge.
ALTER TABLE orders
  ADD CONSTRAINT orders_tenant_bill_member_fk
  FOREIGN KEY (tenant_id, bill_id, id) REFERENCES bill_order (tenant_id, bill_id, order_id);

CREATE INDEX orders_tenant_bill_idx ON orders (tenant_id, bill_id) WHERE bill_id IS NOT NULL;
