BEGIN;

ALTER TABLE interactions
  ADD COLUMN status_reason jsonb;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_status_reason_object_check
  CHECK (status_reason IS NULL OR jsonb_typeof(status_reason) = 'object');

COMMIT;
