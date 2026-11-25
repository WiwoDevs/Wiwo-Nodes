BEGIN;

-- WhatsApp (Baileys, WhatsApp Web no oficial): los mensajes entran como interacciones con canal
-- y origen 'whatsapp'. La sesión de cada número (credenciales) vive en el worker, fuera de la base.
ALTER TABLE interactions
  DROP CONSTRAINT IF EXISTS interactions_provider_check;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_provider_check
  CHECK (provider IN (
    'instagram', 'facebook', 'x', 'tiktok', 'youtube', 'linkedin', 'google_business', 'whatsapp'
  ));

ALTER TABLE interactions
  DROP CONSTRAINT IF EXISTS interactions_source_check;

ALTER TABLE interactions
  ADD CONSTRAINT interactions_source_check
  CHECK (source IN ('demo', 'metricool', 'planilla', 'whatsapp'));

-- Números de WhatsApp por marca. brand_key es el id de la marca en la app (brands.slug).
-- Solo configuración y último estado: el QR y el código de vinculación nunca se guardan.
CREATE TABLE IF NOT EXISTS whatsapp_lines (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  line_id uuid NOT NULL,
  brand_key text NOT NULL CHECK (length(brand_key) BETWEEN 1 AND 120),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  desired_state text NOT NULL CHECK (desired_state IN ('linked', 'unlinked')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  pairing_phone text CHECK (pairing_phone IS NULL OR pairing_phone ~ '^[0-9]{8,15}$'),
  -- Pedir el historial del teléfono al vincular (se importa como historial, no como casos).
  import_history boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN (
    'pending_link', 'connecting', 'connected', 'disconnected', 'logged_out', 'unlinked', 'error'
  )),
  phone_number text,
  display_name text,
  linked_at timestamptz,
  last_connected_at timestamptz,
  last_error text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, line_id)
);

ALTER TABLE whatsapp_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_lines_tenant_isolation ON whatsapp_lines
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMIT;
