"""
Arma la 'foto' de una ejecución a partir de TODAS las observaciones cacheadas en la ventana.
La lógica de agregación y brechas es pura (sin base de datos) para poder testearla.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from . import config, db


# ------------------------------------------------------------------ lógica pura
def aggregate(observations: list[dict]) -> list[dict]:
    """
    Agrupa por (tendencia, país, horizonte). El representante es la observación con
    adoption_pct de mayor confianza (si hay); desempata la más reciente.
    Devuelve [{trend_slug, country_code, horizon, rep, items}].
    """
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for o in observations:
        groups[(o["trend_slug"], o["country_code"], o["horizon"])].append(o)
    out = []
    for (slug, country, horizon), items in groups.items():
        pool = [i for i in items if i.get("adoption_pct") is not None] or items
        rep = max(pool, key=lambda i: (i["confidence"], i.get("doc_date") or ""))
        out.append({"trend_slug": slug, "country_code": country, "horizon": horizon, "rep": rep, "items": items})
    return out


def compute_gaps(statuses: list[dict], home: str = config.HOME_COUNTRY,
                 min_conf: float = config.MIN_REFERENCE_CONFIDENCE) -> list[dict]:
    """
    Brecha nacional por tendencia: adopción 'hoy' en el país local vs. la mejor adopción 'hoy'
    entre los demás países con dato confiable. Puede ser negativa (el país local va adelante).
    """
    by_trend: dict[str, list[dict]] = defaultdict(list)
    for s in statuses:
        if s["horizon"] == "hoy" and s["rep"].get("adoption_pct") is not None:
            by_trend[s["trend_slug"]].append(s)
    gaps = []
    for slug, rows in by_trend.items():
        local = next((r for r in rows if r["country_code"] == home), None)
        refs = [r for r in rows if r["country_code"] != home and r["rep"]["confidence"] >= min_conf]
        if not local or not refs:
            continue
        ref = max(refs, key=lambda r: r["rep"]["adoption_pct"])
        cur, tgt = local["rep"]["adoption_pct"], ref["rep"]["adoption_pct"]
        gaps.append({
            "trend_slug": slug,
            "current_pct": cur,
            "reference_pct": tgt,
            "reference_type": "benchmark_pais",
            "reference_country": ref["country_code"],
            "confidence": round(min(local["rep"]["confidence"], ref["rep"]["confidence"]), 2),
            "rationale": (f"Adopción estimada en {home}: {cur:g}% vs. {ref['country_code']}: {tgt:g}%. "
                          f"({local['rep'].get('adoption_note') or 'sin aclaración'}; "
                          f"{ref['rep'].get('adoption_note') or 'sin aclaración'})"),
            "local": local["rep"],
            "ref": ref["rep"],
        })
    return gaps


# ------------------------------------------------------------------ persistencia
def build_snapshot(sb, run_id: str, taxonomy: list[dict]) -> dict:
    observations = db.window_observations(sb)
    statuses = aggregate(observations)
    gaps = compute_gaps(statuses)

    # Tendencias: el catálogo manda sobre lo que proponga el LLM
    now = datetime.now(timezone.utc).isoformat()
    trends: dict[str, dict] = {
        t["slug"]: {"slug": t["slug"], "name": t["name"], "summary_simple": t["summary_simple"],
                    "category": t["category"], "updated_at": now}
        for t in taxonomy
    }
    for s in statuses:
        if s["trend_slug"] not in trends:
            r = s["rep"]
            trends[s["trend_slug"]] = {"slug": s["trend_slug"], "name": r["trend_name"],
                                       "summary_simple": r["summary_simple"], "category": r["category"],
                                       "updated_at": now}
    trend_ids = db.upsert_trends(sb, list(trends.values()))

    status_rows = [
        {
            "trend_id": trend_ids[s["trend_slug"]], "country_code": s["country_code"], "run_id": run_id,
            "horizon": s["horizon"], "adoption_pct": s["rep"].get("adoption_pct"),
            "adoption_note": s["rep"].get("adoption_note"), "confidence": round(s["rep"]["confidence"], 2),
            "rationale": s["rep"]["rationale"],
        }
        for s in statuses
    ]
    saved = db.insert_rows(sb, "trend_status", status_rows) if status_rows else []
    status_id = {(r["trend_id"], r["country_code"], r["horizon"]): r["id"] for r in saved}

    evidence_rows = []
    for s in statuses:
        tid = trend_ids[s["trend_slug"]]
        sid = status_id.get((tid, s["country_code"], s["horizon"]))
        for it in s["items"]:
            evidence_rows.append({"document_id": it["doc_id"], "trend_id": tid, "trend_status_id": sid,
                                  "quote": it["quote"], "supports": it["supports"]})

    gap_rows = [
        {
            "trend_id": trend_ids[g["trend_slug"]], "segment_id": None, "run_id": run_id,
            "current_pct": g["current_pct"], "reference_pct": g["reference_pct"],
            "reference_type": g["reference_type"], "reference_country": g["reference_country"],
            "confidence": g["confidence"], "rationale": g["rationale"],
        }
        for g in gaps
    ]
    saved_gaps = db.insert_rows(sb, "gaps", gap_rows) if gap_rows else []
    gap_id = {r["trend_id"]: r["id"] for r in saved_gaps}
    for g in gaps:
        tid = trend_ids[g["trend_slug"]]
        gid = gap_id.get(tid)
        for side, obs in (("adopcion", g["local"]), ("referencia", g["ref"])):
            evidence_rows.append({"document_id": obs["doc_id"], "trend_id": tid, "gap_id": gid,
                                  "quote": obs["quote"], "supports": side})
    if evidence_rows:
        db.insert_rows(sb, "evidence", evidence_rows)

    return {"observations": len(observations), "statuses": len(status_rows),
            "gaps": len(gap_rows), "evidence": len(evidence_rows)}
