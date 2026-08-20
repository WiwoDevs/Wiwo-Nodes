BEGIN;

ALTER TABLE workflow_jobs DROP CONSTRAINT IF EXISTS workflow_jobs_kind_check;
ALTER TABLE workflow_jobs
  ADD CONSTRAINT workflow_jobs_kind_check CHECK (kind IN ('sync', 'automation')),
  ADD COLUMN IF NOT EXISTS workflow_key text,
  ADD COLUMN IF NOT EXISTS trigger_mode text CHECK (trigger_mode IS NULL OR trigger_mode IN ('manual', 'webhook', 'schedule', 'subworkflow', 'retry')),
  ADD COLUMN IF NOT EXISTS input_payload jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS workflow_jobs_workflow_idx
  ON workflow_jobs (organization_id, workflow_key, status, created_at DESC)
  WHERE workflow_key IS NOT NULL;

CREATE TABLE automation_platform_states (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(state) = 'object')
);

CREATE INDEX automation_platform_states_workflows_gin_idx
  ON automation_platform_states USING gin ((state -> 'workflows'));

ALTER TABLE automation_platform_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY automation_platform_states_tenant_isolation ON automation_platform_states
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMIT;
