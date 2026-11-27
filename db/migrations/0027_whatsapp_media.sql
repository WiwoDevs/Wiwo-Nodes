BEGIN;

-- Archivos de WhatsApp (fotos, videos, audios, stickers y documentos) que recibe o envía un
-- número vinculado. WhatsApp no entrega enlaces públicos: la API guarda su copia por sha256 y la
-- sirve en /api/media/whatsapp/:key solo a quien ve la marca (brand_key = id de la marca en la app).
CREATE TABLE IF NOT EXISTS whatsapp_media (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  media_key text NOT NULL CHECK (media_key ~ '^[0-9a-f]{64}$'),
  brand_key text NOT NULL CHECK (length(brand_key) BETWEEN 1 AND 120),
  content_type text NOT NULL CHECK (length(content_type) BETWEEN 3 AND 120),
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'sticker', 'document')),
  file_name text CHECK (file_name IS NULL OR length(file_name) <= 120),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 16777216),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, media_key)
);

ALTER TABLE whatsapp_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_media_tenant_isolation ON whatsapp_media;
CREATE POLICY whatsapp_media_tenant_isolation ON whatsapp_media
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Opciones propias de un envío por WhatsApp (adjunto y mensaje citado), aparte de la entrega
-- común para no tocar el outbox que comparte con Metricool. delivery_id = replies.id.
CREATE TABLE IF NOT EXISTS whatsapp_delivery_options (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delivery_id text NOT NULL CHECK (length(delivery_id) BETWEEN 1 AND 120),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, delivery_id)
);

ALTER TABLE whatsapp_delivery_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_delivery_options_tenant_isolation ON whatsapp_delivery_options;
CREATE POLICY whatsapp_delivery_options_tenant_isolation ON whatsapp_delivery_options
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMIT;
