"""
Ejecuta el agente completo:  python -m agent.run

  1) sincroniza las fuentes (sources.yaml -> Supabase)
  2) recolecta documentos nuevos
  3) analiza con Gemini los documentos pendientes (cacheado: no repite trabajo)
  4) arma el snapshot (tendencias, estado por país, brechas, evidencia)

Opciones:  --skip-ingest   no recolecta   |   --skip-analyze   no llama al LLM
           --max-priority N   incluye fuentes hasta prioridad N
"""
from __future__ import annotations

import argparse
import logging
import time

import yaml

from . import analyze, collect, config, db, snapshot

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("agent")


def ingest(sb, run_id: str, max_priority: int) -> tuple[int, int]:
    with open(config.ROOT / "sources.yaml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)["sources"]
    db.upsert_sources(sb, cfg)
    no_feed = {c["slug"] for c in cfg if c.get("no_feed")}
    fetched = new = 0
    for source in db.active_sources(sb, max_priority):
        source["no_feed"] = source["slug"] in no_feed
        try:
            docs, feed = collect.collect_source(source, lambda urls: db.existing_urls(sb, urls))
            if feed and not source.get("feed_url"):
                db.save_feed_url(sb, source["id"], feed)
            fetched += len(docs)
            for doc in docs:
                if db.insert_document(sb, source["id"], run_id, doc):
                    new += 1
        except Exception as e:  # una fuente caída no debe frenar a las demás
            log.exception("[%s] falló la recolección: %s", source["slug"], e)
    return fetched, new


def analyze_pending(sb, limit: int) -> int:
    taxonomy = analyze.load_taxonomy()
    done = 0
    for doc in db.pending_documents(sb, limit):
        try:
            obs, dropped, model = analyze.extract(doc, taxonomy)
        except Exception as e:
            log.error("LLM falló en %s: %s (queda pendiente para la próxima corrida)", doc["url"], e)
            break  # probablemente cuota agotada: cortar y reintentar en la próxima ejecución
        db.save_observations(sb, doc["id"], obs, dropped, model)
        log.info("analizado %s con %s -> %d observaciones (%d descartadas)", doc["url"], model, len(obs), dropped)
        done += 1
        time.sleep(config.LLM_SLEEP_SECONDS)
    return done


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-ingest", action="store_true")
    ap.add_argument("--skip-analyze", action="store_true")
    ap.add_argument("--max-priority", type=int, default=config.MAX_PRIORITY)
    args = ap.parse_args()

    sb = db.connect()
    run_id = db.create_run(sb)
    fetched = new = analyzed = trends_found = 0
    status, notes = "ok", None
    try:
        if not args.skip_ingest:
            fetched, new = ingest(sb, run_id, args.max_priority)
        if not args.skip_analyze:
            analyzed = analyze_pending(sb, config.MAX_ANALYZE_PER_RUN)
        stats = snapshot.build_snapshot(sb, run_id, analyze.load_taxonomy())
        trends_found = stats["statuses"]
        notes = f"analizados={analyzed} {stats}"
        if stats["statuses"] == 0:
            status = "partial"
    except Exception as e:
        log.exception("la corrida falló")
        status, notes = "error", str(e)[:500]
    finally:
        db.finish_run(sb, run_id, status, docs_fetched=fetched, docs_new=new,
                      trends_extracted=trends_found, notes=notes)
    log.info("corrida %s: %s", status, notes)


if __name__ == "__main__":
    main()
