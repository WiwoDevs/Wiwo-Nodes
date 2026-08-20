-- Provider rate-limit backpressure for the reply outbox.
-- A confirmed 429 can be retried safely after the provider cooldown without
-- treating an ambiguous timeout/5xx as retryable.

BEGIN;

ALTER TABLE replies
  ADD COLUMN next_attempt_at timestamptz;

CREATE INDEX replies_pending_due_idx
  ON replies (organization_id, next_attempt_at, created_at)
  WHERE delivery_status = 'pending';

COMMIT;
