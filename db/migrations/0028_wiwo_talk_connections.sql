BEGIN;

-- WiWO Talk (HighLevel con marca blanca): conexiones por subcuenta para atender su WhatsApp desde
-- wiwo.sac. El token de integración privada y el secreto del webhook se guardan cifrados con la
-- clave de credenciales de la API (CredentialVault): nunca en variables de entorno ni en claro.
-- Los mensajes entran como interacciones de WhatsApp (canal y origen 'whatsapp').
CREATE TABLE IF NOT EXISTS wiwo_talk_connections (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  brand_key text NOT NULL CHECK (length(brand_key) BETWEEN 1 AND 120),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  location_id text NOT NULL CHECK (location_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  location_name text,
  encrypted_secrets text NOT NULL,
  token_hint text NOT NULL CHECK (length(token_hint) BETWEEN 1 AND 8),
  status text NOT NULL CHECK (status IN ('active', 'error', 'paused')),
  last_error text,
  last_error_at timestamptz,
  last_sync_at timestamptz,
  last_webhook_at timestamptz,
  sync_cursor timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, connection_id),
  UNIQUE (organization_id, location_id)
);

ALTER TABLE wiwo_talk_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wiwo_talk_connections_tenant_isolation ON wiwo_talk_connections;

CREATE POLICY wiwo_talk_connections_tenant_isolation ON wiwo_talk_connections
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMIT;
