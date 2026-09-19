-- Kitchen / KDS partial index on active order queue.
-- Supports GET /api/v1/kitchen/orders active queue query:
--   WHERE status IN ('NEW', 'ACCEPTED', 'PREPARING', 'READY')
-- Ordered by placed_at ASC (FIFO operational kitchen queue).
-- Filters out COMPLETED and CANCELLED historical orders to avoid full table scans.
CREATE INDEX orders_tenant_active_kitchen_idx ON orders (tenant_id, placed_at ASC)
WHERE status IN ('NEW', 'ACCEPTED', 'PREPARING', 'READY');