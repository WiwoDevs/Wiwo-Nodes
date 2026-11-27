BEGIN;

-- Campana de notificaciones: hasta cuándo leyó cada persona sus avisos (mensajes, comentarios y
-- reseñas nuevas). Se guarda por persona para que valga en cualquier navegador.
ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS notifications_seen_at timestamptz;

COMMIT;
