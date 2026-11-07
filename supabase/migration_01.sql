-- ============================================================
-- Migración 01 (ejecutar UNA vez sobre la base que ya tiene schema.sql)
--  1) Una tendencia puede tener varios horizontes por país en la misma ejecución
--     (p. ej. AR "hoy" 30% y AR "mediano"), así que la clave única incluye horizon.
--  2) doc_observations: caché de lo que el LLM extrajo de cada documento.
--     Evita reprocesar documentos (ahorra cuota gratuita) y permite reanudar corridas.
-- ============================================================

alter table trend_status drop constraint if exists trend_status_trend_id_country_code_run_id_key;
alter table trend_status drop constraint if exists trend_status_unique;
alter table trend_status add constraint trend_status_unique unique (trend_id, country_code, horizon, run_id);

create table if not exists doc_observations (
  document_id  uuid primary key references documents(id) on delete cascade,
  observations jsonb not null default '[]'::jsonb,
  dropped      integer not null default 0,     -- observaciones descartadas por cita no verificable
  model        text,
  analyzed_at  timestamptz not null default now()
);

-- Sin políticas para anon: solo el agente (service_role) la usa.
alter table doc_observations enable row level security;
