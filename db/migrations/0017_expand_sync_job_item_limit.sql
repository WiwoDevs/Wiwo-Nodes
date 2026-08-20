BEGIN;

ALTER TABLE workflow_jobs
  DROP CONSTRAINT IF EXISTS workflow_jobs_item_limit_check;

ALTER TABLE workflow_jobs
  ADD CONSTRAINT workflow_jobs_item_limit_check
  CHECK (item_limit BETWEEN 1 AND 5000);

COMMIT;
