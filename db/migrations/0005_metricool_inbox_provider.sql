BEGIN;

ALTER TABLE metricool_account_refs
  ADD COLUMN instagram_provider text NOT NULL DEFAULT 'INSTAGRAMBUSINESS';

ALTER TABLE metricool_account_refs
  ADD CONSTRAINT metricool_account_refs_instagram_provider_check
  CHECK (instagram_provider IN ('INSTAGRAMBUSINESS', 'INSTAGRAM'));

COMMIT;
