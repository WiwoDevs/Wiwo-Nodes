-- Durable reply delivery outbox. A timed-out provider call is never retried blindly:
-- stale leases become "uncertain" and require explicit reconciliation.

BEGIN;

ALTER TABLE replies DROP CONSTRAINT replies_delivery_status_check;

UPDATE replies
SET delivery_status = CASE delivery_status
  WHEN 'queued' THEN 'pending'
  WHEN 'draft_saved' THEN 'cancelled'
  ELSE delivery_status
END;

ALTER TABLE replies
  ADD CONSTRAINT replies_delivery_status_check
  CHECK (delivery_status IN (
    'pending', 'sending', 'sent', 'failed', 'uncertain', 'cancelled', 'demo_simulated'
  )),
  ADD COLUMN approved_by_human boolean NOT NULL DEFAULT false,
  ADD COLUMN requested_by jsonb NOT NULL DEFAULT '{"userId":"migration","displayName":"Migración"}'::jsonb,
  ADD COLUMN request_id text NOT NULL DEFAULT 'migration',
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN reconciled_at timestamptz,
  ADD COLUMN reconciled_by jsonb,
  ADD COLUMN reconciliation_note text,
  ADD CONSTRAINT replies_requested_by_object_check
    CHECK (jsonb_typeof(requested_by) = 'object'),
  ADD CONSTRAINT replies_reconciled_by_object_check
    CHECK (reconciled_by IS NULL OR jsonb_typeof(reconciled_by) = 'object'),
  ADD CONSTRAINT replies_reconciliation_note_length_check
    CHECK (reconciliation_note IS NULL OR char_length(reconciliation_note) <= 2000);

CREATE INDEX replies_delivery_status_idx
  ON replies (organization_id, delivery_status, updated_at DESC);

CREATE INDEX replies_stale_lease_idx
  ON replies (organization_id, lease_expires_at)
  WHERE delivery_status = 'sending';

CREATE UNIQUE INDEX replies_one_active_per_interaction
  ON replies (organization_id, interaction_id)
  WHERE delivery_status IN ('pending', 'sending', 'uncertain');

COMMIT;
