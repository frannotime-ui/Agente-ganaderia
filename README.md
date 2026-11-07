# Monitor de ganadería bovina de carne (Argentina + benchmarks)

Agente de IA que recolecta información pública del sector, extrae tendencias con un LLM,
las clasifica por horizonte (hoy / corto / mediano / largo) y calcula brechas contra otros países.
Cada dato queda ligado a una cita textual verificable y a su fuente.

## Cómo funciona

1. **Fuentes** (`agent/sources.yaml`): cada una con su justificación.
2. **Recolección** (`agent/fetch.py`, `collect.py`): RSS si existe; si no, links de la página. HTML y PDF. Respeta `robots.txt` y espera entre pedidos.
3. **Análisis** (`agent/analyze.py`): Gemini devuelve observaciones estructuradas. **Si la cita no aparece textual en el documento, la observación se descarta.**
4. **Caché** (`doc_observations`): cada documento se analiza una sola vez (cuida la cuota gratuita y permite reanudar).
5. **Snapshot** (`agent/snapshot.py`): por cada ejecución guarda estado por país y horizonte, brechas y evidencia.

## Puesta en marcha

1. Supabase: ejecutar `supabase/schema.sql` y luego `supabase/migration_01.sql` (si el esquema ya estaba cargado antes de la migración).
2. Copiar `.env.example` a `.env` y completar `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` y `GEMINI_API_KEY`.
3. Instalar: `python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
4. **Sondear las fuentes** (no usa Supabase ni Gemini): `python -m agent.probe`
5. Tests de la lógica: `python -m tests.test_logic`
6. Primera corrida: `python -m agent.run`

## Automatizar (GitHub Actions)

Subir el repo a GitHub, cargar `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` y `GEMINI_API_KEY` en
*Settings > Secrets and variables > Actions*. Corre solo los lunes y también a mano desde la pestaña *Actions*.

## Ajustes útiles (variables de entorno)

`GEMINI_MODEL`, `MAX_PRIORITY` (2 suma las fuentes secundarias), `MAX_LINKS_PER_SOURCE`,
`MAX_ANALYZE_PER_RUN`, `LLM_SLEEP_SECONDS`, `WINDOW_DAYS`.

## Limitaciones conocidas (para el informe)

- Cuota gratuita del LLM: se procesa en lotes y lo pendiente sigue en la próxima corrida.
- Sitios que cargan contenido con JavaScript o cambian de estructura pueden no ser legibles.
- Las brechas actuales son **nacionales** (Argentina vs. mejor referencia con confianza suficiente); la estimación por segmento de productor es un paso posterior.
- Los porcentajes de adopción dependen de que las fuentes los publiquen; sin dato explícito no se inventa.
