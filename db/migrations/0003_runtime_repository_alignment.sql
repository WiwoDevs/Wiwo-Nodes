BEGIN;

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS account_key text;

UPDATE social_accounts
  SET account_key = lower(regexp_replace(handle, '[^a-zA-Z0-9]+', '-', 'g'))
  WHERE account_key IS NULL;

ALTER TABLE social_accounts
  ALTER COLUMN account_key SET NOT NULL;

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT ARRAY['instagram']::text[];

ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_channels_valid
  CHECK (
    cardinality(channels) BETWEEN 1 AND 2
    AND channels <@ ARRAY['instagram', 'facebook']::text[]
  );

CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_account_key_unique
  ON social_accounts (organization_id, account_key);

ALTER TABLE workflow_configs
  ADD COLUMN IF NOT EXISTS workflow_key text;

UPDATE workflow_configs
  SET workflow_key = 'workflow-sac-metricool'
  WHERE workflow_key IS NULL;

ALTER TABLE workflow_configs
  ALTER COLUMN workflow_key SET NOT NULL;

ALTER TABLE workflow_configs
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_run_status text CHECK (last_run_status IN ('success', 'partial', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS workflow_configs_workflow_key_unique
  ON workflow_configs (organization_id, workflow_key);

ALTER TABLE workflow_edges
  ADD COLUMN IF NOT EXISTS edge_key text;

UPDATE workflow_edges
  SET edge_key = id::text
  WHERE edge_key IS NULL;

ALTER TABLE workflow_edges
  ALTER COLUMN edge_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workflow_edges_edge_key_unique
  ON workflow_edges (organization_id, workflow_id, edge_key);

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS interaction_key text,
  ADD COLUMN IF NOT EXISTS response_text text,
  ADD COLUMN IF NOT EXISTS audit_trail jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE interactions
  SET interaction_key = id::text
  WHERE interaction_key IS NULL;

ALTER TABLE interactions
  ALTER COLUMN interaction_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS interactions_interaction_key_unique
  ON interactions (organization_id, interaction_key);

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS run_key text,
  ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS audit_trail jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE sync_runs
  SET run_key = id::text
  WHERE run_key IS NULL;

ALTER TABLE sync_runs
  ALTER COLUMN run_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sync_runs_run_key_unique
  ON sync_runs (organization_id, run_key);

COMMIT;
