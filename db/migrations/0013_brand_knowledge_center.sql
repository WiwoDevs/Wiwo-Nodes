BEGIN;

ALTER TABLE brands
  ADD COLUMN qa_workbook_config jsonb,
  ADD COLUMN resources jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE brands
SET resources = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'name', 'Excel de registros SAC',
    'kind', 'records_workbook',
    'url', workbook_config ->> 'spreadsheetUrl',
    'description', 'Libro maestro de mensajes directos y comentarios.',
    'addedAt', COALESCE(workbook_config ->> 'validatedAt', NOW()::text),
    'addedBy', COALESCE(workbook_config ->> 'validatedBy', 'migration')
  )
)
WHERE workbook_config IS NOT NULL
  AND resources = '[]'::jsonb;

COMMIT;
