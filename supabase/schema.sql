-- ============================================================
-- Monitor de ganadería bovina de carne (Argentina + benchmarks)
-- Esquema para Supabase (Postgres). Pegar completo en el SQL Editor.
-- ============================================================
-- Convenciones
--   Horizontes: hoy = práctica actual | corto = 0-2 años | mediano = 2-5 años | largo = 5+ años
--   Países: código ISO-2 (AR, UY, BR, AU, US...). NULL = organismo global.
--   El agente escribe con la service_role key (salta RLS).
--   El dashboard lee con la anon key (solo lectura, ver políticas al final).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Fuentes ----------
create table if not exists sources (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  url           text not null,
  feed_url      text,
  access_type   text not null check (access_type in ('rss','web','pdf','api')),
  source_type   text not null check (source_type in
                  ('gobierno','instituto_tecnico','gremio','medio','organismo_internacional','academico')),
  country_code  text,
  justification text not null,           -- por qué se eligió (requisito de la consigna)
  priority      smallint not null default 1,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------- Ejecuciones del agente ----------
create table if not exists runs (
  id               uuid primary key default gen_random_uuid(),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running' check (status in ('running','ok','partial','error')),
  docs_fetched     integer not null default 0,
  docs_new         integer not null default 0,
  trends_extracted integer not null default 0,
  notes            text
);

-- ---------- Documentos descargados ----------
create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references sources(id) on delete cascade,
  run_id        uuid references runs(id) on delete set null,
  url           text not null unique,
  title         text,
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  language      text,
  content_hash  text not null,
  content_text  text not null
);
create index if not exists documents_source_idx on documents(source_id);
create index if not exists documents_published_idx on documents(published_at desc);

-- ---------- Tendencias ----------
create table if not exists trends (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null,
  name           text not null,
  summary_simple text not null,          -- una frase en lenguaje de campo
  category       text not null check (category in ('tecnologia','mercado','regulacion','financiamiento')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------- Estado de cada tendencia por país (hoy / qué viene) ----------
create table if not exists trend_status (
  id            uuid primary key default gen_random_uuid(),
  trend_id      uuid not null references trends(id) on delete cascade,
  country_code  text not null,
  run_id        uuid not null references runs(id) on delete cascade,
  horizon       text not null check (horizon in ('hoy','corto','mediano','largo')),
  adoption_pct  numeric(5,2) check (adoption_pct between 0 and 100),
  adoption_note text,                    -- a qué se refiere el % (p. ej. "% del rodeo con caravana electrónica")
  confidence    numeric(3,2) not null check (confidence between 0 and 1),
  rationale     text not null,
  created_at    timestamptz not null default now(),
  constraint trend_status_unique unique (trend_id, country_code, horizon, run_id)
);
create index if not exists trend_status_country_idx on trend_status(country_code, run_id);

-- ---------- Segmentos de productor (dentro de Argentina) ----------
create table if not exists segments (
  id        uuid primary key default gen_random_uuid(),
  region    text check (region in ('pampa_humeda','nea','noa','cuyo','patagonia')),
  herd_band text check (herd_band in ('chico','mediano','grande')),   -- <500 | 500-2000 | >2000 cabezas
  stage     text check (stage in ('cria','recria','invernada','feedlot','ciclo_completo')),
  unique nulls not distinct (region, herd_band, stage)                -- la fila toda NULL = promedio nacional
);

-- ---------- Brechas ----------
create table if not exists gaps (
  id                uuid primary key default gen_random_uuid(),
  trend_id          uuid not null references trends(id) on delete cascade,
  segment_id        uuid references segments(id),        -- NULL = promedio nacional
  run_id            uuid not null references runs(id) on delete cascade,
  current_pct       numeric(5,2) not null check (current_pct between 0 and 100),
  reference_pct     numeric(5,2) not null check (reference_pct between 0 and 100),
  reference_type    text not null check (reference_type in ('benchmark_pais','potencial_tecnico')),
  reference_country text,                                -- si es benchmark_pais
  gap_pct           numeric(5,2) generated always as (reference_pct - current_pct) stored,
  confidence        numeric(3,2) not null check (confidence between 0 and 1),
  rationale         text not null,
  created_at        timestamptz not null default now()
);
create index if not exists gaps_run_idx on gaps(run_id);

-- ---------- Evidencia (trazabilidad: cada dato apunta a su cita) ----------
create table if not exists evidence (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references documents(id) on delete cascade,
  trend_id         uuid not null references trends(id) on delete cascade,
  trend_status_id  uuid references trend_status(id) on delete cascade,
  gap_id           uuid references gaps(id) on delete cascade,
  quote            text not null,        -- cita textual del documento
  supports         text not null check (supports in ('adopcion','horizonte','referencia')),
  created_at       timestamptz not null default now()
);
create index if not exists evidence_trend_idx on evidence(trend_id);

-- ---------- Caché de observaciones del LLM por documento (solo el agente la usa) ----------
create table if not exists doc_observations (
  document_id  uuid primary key references documents(id) on delete cascade,
  observations jsonb not null default '[]'::jsonb,
  dropped      integer not null default 0,
  model        text,
  analyzed_at  timestamptz not null default now()
);
alter table doc_observations enable row level security;

-- ---------- Vista: última ejecución exitosa ----------
create or replace view latest_run as
  select id from runs
  where status in ('ok','partial')
  order by started_at desc
  limit 1;

-- ---------- Segmentos base ----------
insert into segments (region, herd_band, stage) values (null, null, null) on conflict do nothing;
insert into segments (region) select unnest(array['pampa_humeda','nea','noa','cuyo','patagonia']) on conflict do nothing;
insert into segments (herd_band) select unnest(array['chico','mediano','grande']) on conflict do nothing;
insert into segments (stage) select unnest(array['cria','recria','invernada','feedlot','ciclo_completo']) on conflict do nothing;

-- ---------- Seguridad: lectura pública, escritura solo service_role ----------
alter table sources      enable row level security;
alter table runs         enable row level security;
alter table documents    enable row level security;
alter table trends       enable row level security;
alter table trend_status enable row level security;
alter table segments     enable row level security;
alter table gaps         enable row level security;
alter table evidence     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sources','runs','documents','trends','trend_status','segments','gaps','evidence']
  loop
    execute format('drop policy if exists "read_%1$s" on %1$s', t);
    execute format('create policy "read_%1$s" on %1$s for select to anon, authenticated using (true)', t);
  end loop;
end $$;
