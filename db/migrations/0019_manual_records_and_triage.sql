BEGIN;

-- Registros cargados a mano desde el Excel BD SAC (TikTok y LinkedIn, que Metricool no trae):
-- se guardan como interacciones con source 'planilla' y cuentan en Reportes y METRIQ.
ALTER TABLE interactions
  DROP CONSTRAINT IF EXISTS interactions_source_check;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_source_check
  CHECK (source IN ('demo', 'metricool', 'planilla'));

-- Marca "es caso SAC / es ruido" (manual o de IA). Antes solo vivía en el store JSON: en
-- PostgreSQL se perdía al guardar.
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS sac_triage jsonb;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_sac_triage_object_check
  CHECK (sac_triage IS NULL OR jsonb_typeof(sac_triage) = 'object');

COMMIT;
