BEGIN;

ALTER TABLE workflow_configs
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS published_version integer NOT NULL DEFAULT 1 CHECK (published_version > 0),
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by text;

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS workflow_version integer NOT NULL DEFAULT 1 CHECK (workflow_version > 0),
  ADD COLUMN IF NOT EXISTS requested_by text,
  ADD COLUMN IF NOT EXISTS retry_of text;

CREATE INDEX IF NOT EXISTS sync_runs_retry_of_idx
  ON sync_runs (organization_id, retry_of)
  WHERE retry_of IS NOT NULL;

CREATE TABLE workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES workflow_configs(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  change_note text,
  UNIQUE (organization_id, workflow_id, version)
);

CREATE INDEX workflow_versions_history_idx
  ON workflow_versions (organization_id, workflow_id, version DESC);

ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_versions_tenant_isolation ON workflow_versions
  USING (organization_id = current_setting('app.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);

CREATE TABLE workflow_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_key text NOT NULL,
  schedule_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sync')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'retry', 'succeeded', 'dead')),
  account_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  item_limit integer NOT NULL CHECK (item_limit BETWEEN 1 AND 100),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  run_key text,
  last_error text,
  UNIQUE (organization_id, job_key),
  UNIQUE (organization_id, schedule_key)
);

CREATE INDEX workflow_jobs_due_idx
  ON workflow_jobs (organization_id, status, next_attempt_at)
  WHERE status IN ('queued', 'retry');

ALTER TABLE workflow_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_jobs_tenant_isolation ON workflow_jobs
  USING (organization_id = current_setting('app.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.organization_id', true)::uuid);

COMMIT;
