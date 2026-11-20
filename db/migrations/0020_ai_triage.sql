BEGIN;

-- Clasificación de IA en modo sombra (proveedor configurable, hoy DeepSeek vía BytePlus
-- ModelArk). Va aparte de sac_triage para no contar en Reportes hasta medir su concordancia
-- con las marcas manuales; solo su señal "sensible" actúa, y solo para exigir revisión humana.
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS ai_triage jsonb;

ALTER TABLE interactions
  DROP CONSTRAINT IF EXISTS interactions_ai_triage_object_check;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_ai_triage_object_check
  CHECK (ai_triage IS NULL OR jsonb_typeof(ai_triage) = 'object');

COMMIT;
