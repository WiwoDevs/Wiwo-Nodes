BEGIN;

-- WhatsApp por persona (Usuarios y roles): si puede ver Gestión WhatsApp y enviar por WhatsApp.
-- Reemplaza a las variables SAC_FLOW_WHATSAPP_ENABLED / SAC_FLOW_WHATSAPP_SENDS_ENABLED. Activado
-- por defecto para todas las personas; solo un admin principal lo apaga a alguien.
ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS whatsapp_updated_by text;

ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS whatsapp_updated_at timestamptz;

COMMIT;
