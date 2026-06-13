-- 071: Extended porting_orders lifecycle statuses (action_required, submitted, etc.).
-- Run in Neon SQL Editor after 070-porting-rejection-reason.sql.

ALTER TABLE porting_orders DROP CONSTRAINT IF EXISTS porting_orders_status_check;

ALTER TABLE porting_orders
  ADD CONSTRAINT porting_orders_status_check CHECK (
    status IN (
      'pending',
      'processing',
      'completed',
      'rejected',
      'action_required',
      'pending_info',
      'submitted',
      'pending_carrier_review'
    )
  );

COMMENT ON COLUMN porting_orders.status IS
  'Lifecycle: submitted/pending_carrier_review (in progress), action_required/pending_info (owner must respond), rejected, completed.';
