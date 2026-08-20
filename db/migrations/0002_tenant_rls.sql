BEGIN;

CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid;
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE metricool_account_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_account_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizations_tenant_isolation ON organizations
  USING (id = current_organization_id())
  WITH CHECK (id = current_organization_id());

CREATE POLICY memberships_tenant_isolation ON memberships
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY brands_tenant_isolation ON brands
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY social_accounts_tenant_isolation ON social_accounts
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY metricool_account_refs_tenant_isolation ON metricool_account_refs
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY workflow_configs_tenant_isolation ON workflow_configs
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY workflow_account_allowlist_tenant_isolation ON workflow_account_allowlist
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY workflow_nodes_tenant_isolation ON workflow_nodes
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY workflow_edges_tenant_isolation ON workflow_edges
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY interactions_tenant_isolation ON interactions
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY replies_tenant_isolation ON replies
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY sync_runs_tenant_isolation ON sync_runs
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY sync_run_items_tenant_isolation ON sync_run_items
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY audit_events_tenant_isolation ON audit_events
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY idempotency_keys_tenant_isolation ON idempotency_keys
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY export_jobs_tenant_isolation ON export_jobs
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMENT ON FUNCTION current_organization_id() IS
  'Application code must SET LOCAL app.organization_id before tenant-scoped queries.';

COMMIT;
