BEGIN;

-- Copia de la miniatura de cada publicación comentada. Meta firma sus enlaces de imagen con fecha
-- de vencimiento y Metricool solo trae uno nuevo cuando llegan comentarios: la API guarda la imagen
-- la primera vez que se pide y la sirve desde /api/media/post-thumbnail/:key (server/post-thumbnails.ts).
-- thumbnail_key es un hash opaco de cuenta + publicación; brand_id (slug) decide quién puede verla.
CREATE TABLE IF NOT EXISTS post_thumbnails (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thumbnail_key text NOT NULL CHECK (thumbnail_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  brand_id text NOT NULL CHECK (length(brand_id) BETWEEN 1 AND 100),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 2097152),
  source_host text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, thumbnail_key)
);

ALTER TABLE post_thumbnails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_thumbnails_tenant_isolation ON post_thumbnails;
CREATE POLICY post_thumbnails_tenant_isolation ON post_thumbnails
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMIT;
