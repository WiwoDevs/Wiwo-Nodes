BEGIN;

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assigned_to_user_id text,
  ADD COLUMN IF NOT EXISTS assigned_to_display_name text,
  ADD COLUMN IF NOT EXISTS internal_notes jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_version_positive
  CHECK (version >= 1);

ALTER TABLE interactions
  ADD CONSTRAINT interactions_assignment_complete
  CHECK (
    (assigned_to_user_id IS NULL AND assigned_to_display_name IS NULL)
    OR
    (assigned_to_user_id IS NOT NULL AND assigned_to_display_name IS NOT NULL)
  );

ALTER TABLE interactions
  ADD CONSTRAINT interactions_internal_notes_array
  CHECK (jsonb_typeof(internal_notes) = 'array');

CREATE INDEX IF NOT EXISTS interactions_assignment_idx
  ON interactions (organization_id, assigned_to_user_id, status, received_at DESC);

COMMIT;
