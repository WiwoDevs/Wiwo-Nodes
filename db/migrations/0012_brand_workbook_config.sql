BEGIN;

ALTER TABLE brands
  ADD COLUMN workbook_config jsonb;

COMMIT;
