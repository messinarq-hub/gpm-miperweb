-- Esquema de base de datos para MIPER Nave 4/4 — registro y trazabilidad de controles
-- Ejecutar este script una sola vez en el "SQL Editor" de Neon.

CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro histórico de cada marca de control (append-only, para trazabilidad completa).
-- Cada vez que un inspector marca una casilla, se agrega una fila nueva; nunca se sobrescribe.
CREATE TABLE IF NOT EXISTS controles_log (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  cat_id        TEXT NOT NULL,
  cat_label     TEXT NOT NULL,
  task_idx      INTEGER NOT NULL,
  tarea         TEXT NOT NULL,
  riesgo_idx    INTEGER NOT NULL,
  riesgo        TEXT NOT NULL,
  factor_idx    INTEGER,
  factor        TEXT,
  estado        TEXT NOT NULL CHECK (estado IN ('no_aplica', 'cumple', 'no_cumple')),
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_controles_task
  ON controles_log (cat_id, task_idx);

CREATE INDEX IF NOT EXISTS idx_controles_control_cell
  ON controles_log (cat_id, task_idx, riesgo_idx, factor_idx, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_controles_username
  ON controles_log (username);
