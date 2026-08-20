BEGIN;

ALTER TABLE social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_provider_check;

ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_provider_check
  CHECK (provider IN (
    'instagram', 'facebook', 'x', 'tiktok', 'youtube', 'linkedin', 'google_business'
  ));

ALTER TABLE social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_channels_valid;

ALTER TABLE social_accounts
  ADD CONSTRAINT social_accounts_channels_valid
  CHECK (
    cardinality(channels) BETWEEN 1 AND 7
    AND channels <@ ARRAY[
      'instagram', 'facebook', 'x', 'tiktok', 'youtube', 'linkedin', 'google_business'
    ]::text[]
  );

ALTER TABLE interactions
  DROP CONSTRAINT IF EXISTS interactions_provider_check;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_provider_check
  CHECK (provider IN (
    'instagram', 'facebook', 'x', 'tiktok', 'youtube', 'linkedin', 'google_business'
  ));

ALTER TABLE interactions
  DROP CONSTRAINT IF EXISTS interactions_kind_check;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_kind_check
  CHECK (kind IN ('dm', 'comment', 'review'));

COMMIT;
