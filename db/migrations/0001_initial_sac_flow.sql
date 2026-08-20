BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject text NOT NULL UNIQUE,
  display_name text NOT NULL,
  email_hash text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer', 'agent', 'supervisor', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#292725',
  active boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, slug)
);

CREATE TABLE social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('instagram', 'facebook')),
  handle text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metricool_source text NOT NULL DEFAULT 'none' CHECK (metricool_source IN ('none', 'stored', 'env', 'fallback')),
  metricool_reference_fingerprint text,
  metricool_reference_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, provider, handle),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE metricool_account_refs (
  social_account_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  encrypted_user_id bytea NOT NULL,
  encrypted_blog_id bytea NOT NULL,
  key_version text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, fingerprint),
  FOREIGN KEY (organization_id, social_account_id) REFERENCES social_accounts(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE workflow_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  poll_interval_minutes integer NOT NULL CHECK (poll_interval_minutes BETWEEN 1 AND 1440),
  auto_reply_enabled boolean NOT NULL DEFAULT false,
  minimum_confidence numeric(4,3) NOT NULL CHECK (minimum_confidence >= 0 AND minimum_confidence <= 1),
  require_human_for text[] NOT NULL DEFAULT ARRAY[]::text[],
  business_hours_only boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE workflow_account_allowlist (
  organization_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  social_account_id uuid NOT NULL,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, workflow_id, social_account_id),
  FOREIGN KEY (organization_id, workflow_id) REFERENCES workflow_configs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, social_account_id) REFERENCES social_accounts(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE workflow_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  node_key text NOT NULL,
  type text NOT NULL CHECK (type IN ('schedule', 'metricool', 'normalize', 'deduplicate', 'classify', 'guardrail', 'reply', 'excel', 'escalate')),
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  position_x numeric NOT NULL,
  position_y numeric NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workflow_id, node_key),
  FOREIGN KEY (organization_id, workflow_id) REFERENCES workflow_configs(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE workflow_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  source_node_key text NOT NULL,
  target_node_key text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workflow_id, source_node_key, target_node_key),
  FOREIGN KEY (organization_id, workflow_id, source_node_key) REFERENCES workflow_nodes(organization_id, workflow_id, node_key) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, workflow_id, target_node_key) REFERENCES workflow_nodes(organization_id, workflow_id, node_key) ON DELETE CASCADE
);

CREATE TABLE interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  social_account_id uuid NOT NULL,
  external_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('instagram', 'facebook')),
  kind text NOT NULL CHECK (kind IN ('dm', 'comment')),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  customer_name text NOT NULL,
  customer_handle text NOT NULL,
  body_text text NOT NULL,
  category text NOT NULL DEFAULT 'sin_clasificar',
  sentiment text NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  confidence numeric(4,3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'pending', 'drafted', 'replied', 'escalated', 'resolved')),
  source text NOT NULL DEFAULT 'metricool' CHECK (source IN ('demo', 'metricool')),
  received_at timestamptz NOT NULL,
  responded_at timestamptz,
  metricool_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, social_account_id, kind, external_id),
  FOREIGN KEY (organization_id, brand_id) REFERENCES brands(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, social_account_id) REFERENCES social_accounts(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  interaction_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('draft', 'send')),
  body_text text NOT NULL,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  delivery_status text NOT NULL CHECK (delivery_status IN ('draft_saved', 'queued', 'sent', 'failed', 'demo_simulated')),
  idempotency_key text,
  provider_response_ref text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, interaction_id) REFERENCES interactions(organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX replies_idempotency_unique
  ON replies (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('simulation', 'sync')),
  status text NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE sync_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  sync_run_id uuid NOT NULL,
  social_account_id uuid,
  status text NOT NULL CHECK (status IN ('success', 'skipped', 'warning', 'failed')),
  node text NOT NULL,
  detail text NOT NULL,
  fetched_count integer NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  created_count integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, sync_run_id) REFERENCES sync_runs(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, social_account_id) REFERENCES social_accounts(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('system', 'workflow', 'agent', 'admin')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  action text NOT NULL,
  detail text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, scope, key)
);

CREATE TABLE export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  object_ref text,
  row_count integer CHECK (row_count IS NULL OR row_count >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE INDEX brands_org_active_idx ON brands (organization_id, active);
CREATE INDEX social_accounts_brand_idx ON social_accounts (organization_id, brand_id, active);
CREATE INDEX interactions_inbox_idx ON interactions (organization_id, status, received_at DESC);
CREATE INDEX interactions_account_time_idx ON interactions (organization_id, social_account_id, received_at DESC);
CREATE INDEX interactions_brand_time_idx ON interactions (organization_id, brand_id, received_at DESC);
CREATE INDEX interactions_search_idx ON interactions USING gin (to_tsvector('simple', body_text || ' ' || customer_name || ' ' || customer_handle || ' ' || category));
CREATE INDEX replies_interaction_idx ON replies (organization_id, interaction_id, created_at DESC);
CREATE INDEX sync_runs_org_time_idx ON sync_runs (organization_id, started_at DESC);
CREATE INDEX audit_events_subject_idx ON audit_events (organization_id, subject_type, subject_id, created_at DESC);
CREATE INDEX audit_events_action_idx ON audit_events (organization_id, action, created_at DESC);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at);
CREATE INDEX export_jobs_status_idx ON export_jobs (organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER social_accounts_set_updated_at BEFORE UPDATE ON social_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER metricool_account_refs_set_updated_at BEFORE UPDATE ON metricool_account_refs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workflow_configs_set_updated_at BEFORE UPDATE ON workflow_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER workflow_nodes_set_updated_at BEFORE UPDATE ON workflow_nodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER interactions_set_updated_at BEFORE UPDATE ON interactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER export_jobs_set_updated_at BEFORE UPDATE ON export_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
