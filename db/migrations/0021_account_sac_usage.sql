BEGIN;

-- Marca «En SAC» de Clientes: redes de la cuenta que el equipo usa hoy en SAC. Es solo una
-- etiqueta para filtrar (no oculta ni deja de sincronizar). NULL = nunca se marcó: la API la
-- precarga una sola vez al arrancar, calzando por nombre de cuenta y red (server/sac-usage.ts).
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS sac_channels text[];

COMMIT;
