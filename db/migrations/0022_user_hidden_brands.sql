BEGIN;

-- Clientes que un admin principal le oculta a una persona (Usuarios y roles). Salen de su alcance
-- de marcas en todas las rutas; no se borra nada. No aplica a los admins principales.
ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS hidden_brand_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE user_access
  DROP CONSTRAINT IF EXISTS user_access_hidden_brand_ids_array_check;

ALTER TABLE user_access
  ADD CONSTRAINT user_access_hidden_brand_ids_array_check
  CHECK (jsonb_typeof(hidden_brand_ids) = 'array');

ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS hidden_brands_updated_by text;

ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS hidden_brands_updated_at timestamptz;

COMMIT;
