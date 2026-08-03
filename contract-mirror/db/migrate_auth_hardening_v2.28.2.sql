-- v2.28.2: timestamp dedicado para rotación de refresh.
-- Idempotente para instalaciones existentes; no cambia contratos públicos.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS refresh_rotated_at TIMESTAMPTZ;
