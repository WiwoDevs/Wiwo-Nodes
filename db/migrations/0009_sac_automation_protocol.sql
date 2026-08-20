BEGIN;

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS sac_policy jsonb;

ALTER TABLE brands
  ADD CONSTRAINT brands_sac_policy_object_check
  CHECK (sac_policy IS NULL OR jsonb_typeof(sac_policy) = 'object');

ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS automation_assessment jsonb;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_automation_assessment_object_check
  CHECK (automation_assessment IS NULL OR jsonb_typeof(automation_assessment) = 'object');

CREATE INDEX IF NOT EXISTS interactions_automation_route_idx
  ON interactions (organization_id, ((automation_assessment ->> 'effectiveRoute')), received_at DESC)
  WHERE automation_assessment IS NOT NULL;

COMMIT;
