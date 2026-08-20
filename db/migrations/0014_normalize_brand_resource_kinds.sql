BEGIN;

UPDATE brands
SET resources = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN resource ->> 'kind' = 'records_workbook'
        THEN jsonb_set(resource, '{kind}', '"records"'::jsonb)
      WHEN resource ->> 'kind' = 'qa_workbook'
        THEN jsonb_set(resource, '{kind}', '"qa"'::jsonb)
      ELSE resource
    END
  )
  FROM jsonb_array_elements(resources) AS resource
), '[]'::jsonb)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(resources) AS resource
  WHERE resource ->> 'kind' IN ('records_workbook', 'qa_workbook')
);

COMMIT;
