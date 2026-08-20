BEGIN;

ALTER TABLE workflow_edges
  ADD COLUMN IF NOT EXISTS connector_type text NOT NULL DEFAULT 'smoothstep';

ALTER TABLE workflow_edges
  ADD CONSTRAINT workflow_edges_connector_type_valid
  CHECK (connector_type IN ('smoothstep', 'bezier', 'straight'));

COMMIT;
