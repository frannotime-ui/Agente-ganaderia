"""Capa de acceso a Supabase (usa la service_role key; solo corre en el agente)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

from supabase import Client, create_client

from . import config


def connect() -> Client:
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_KEY:
        raise RuntimeError("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY (ver .env.example)")
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)


def chunks(items: list, n: int) -> Iterable[list]:
    for i in range(0, len(items), n):
        yield items[i : i + n]


def paged_select(sb: Client, table: str, cols: str, order: str | None = None, desc: bool = True, page: int = 1000):
    start = 0
    while True:
        q = sb.table(table).select(cols)
        if order:
            q = q.order(order, desc=desc)
        rows = q.range(start, start + page - 1).execute().data
        yield from rows
        if len(rows) < page:
            return
        start += page


# ---------------------------------------------------------------- fuentes
def upsert_sources(sb: Client, sources: list[dict]) -> None:
    # feed_url NO se toca acá: lo descubre el agente y se guarda aparte.
    rows = [
        {
            "slug": s["slug"], "name": s["name"], "url": s["url"], "access_type": s["access"],
            "source_type": s["type"], "country_code": s.get("country"),
            "justification": s["justification"], "priority": s.get("priority", 1), "active": True,
        }
        for s in sources
    ]
    sb.table("sources").upsert(rows, on_conflict="slug").execute()
    # Fuentes marcadas no_feed: se borra cualquier feed guardado (p. ej. uno genérico de todo el portal)
    for s in sources:
        if s.get("no_feed"):
            sb.table("sources").update({"feed_url": None}).eq("slug", s["slug"]).execute()


def active_sources(sb: Client, max_priority: int) -> list[dict]:
    return (sb.table("sources").select("*").eq("active", True).lte("priority", max_priority).execute().data)


def save_feed_url(sb: Client, source_id: str, feed_url: str) -> None:
    sb.table("sources").update({"feed_url": feed_url}).eq("id", source_id).execute()


# ---------------------------------------------------------------- corridas
def create_run(sb: Client) -> str:
    return sb.table("runs").insert({"status": "running"}).execute().data[0]["id"]


def finish_run(sb: Client, run_id: str, status: str, **fields) -> None:
    sb.table("runs").update(
        {"status": status, "finished_at": datetime.now(timezone.utc).isoformat(), **fields}
    ).eq("id", run_id).execute()


# ---------------------------------------------------------------- documentos
def existing_urls(sb: Client, urls: list[str]) -> set[str]:
    found: set[str] = set()
    for part in chunks(urls, 40):
        rows = sb.table("documents").select("url").in_("url", part).execute().data
        found.update(r["url"] for r in rows)
    return found


def insert_document(sb: Client, source_id: str, run_id: str, doc: dict) -> str | None:
    row = {
        "source_id": source_id, "run_id": run_id, "url": doc["url"], "title": doc.get("title"),
        "published_at": doc["published_at"].isoformat() if doc.get("published_at") else None,
        "language": doc.get("language"), "content_hash": doc["content_hash"], "content_text": doc["text"],
    }
    try:
        return sb.table("documents").insert(row).execute().data[0]["id"]
    except Exception:  # URL duplicada por una corrida paralela: se ignora
        return None


def pending_documents(sb: Client, limit: int) -> list[dict]:
    """Documentos que todavía no pasaron por el LLM (más recientes primero)."""
    analyzed = {r["document_id"] for r in paged_select(sb, "doc_observations", "document_id")}
    pending: list[dict] = []
    for row in paged_select(sb, "documents", "id,url,title,content_text,published_at", order="fetched_at"):
        if row["id"] not in analyzed:
            pending.append(row)
            if len(pending) >= limit:
                break
    return pending


def save_observations(sb: Client, doc_id: str, observations: list[dict], dropped: int, model: str) -> None:
    sb.table("doc_observations").upsert(
        {"document_id": doc_id, "observations": observations, "dropped": dropped, "model": model},
        on_conflict="document_id",
    ).execute()


# ---------------------------------------------------------------- snapshot
def window_observations(sb: Client) -> list[dict]:
    """Observaciones cacheadas de los documentos dentro de la ventana, con datos del documento."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=config.WINDOW_DAYS)
    docs: dict[str, dict] = {}
    for d in paged_select(sb, "documents", "id,source_id,url,title,published_at,fetched_at"):
        when = d["published_at"] or d["fetched_at"]
        if datetime.fromisoformat(when.replace("Z", "+00:00")) >= cutoff:
            docs[d["id"]] = d
    out: list[dict] = []
    for part in chunks(list(docs), 40):
        rows = sb.table("doc_observations").select("document_id,observations").in_("document_id", part).execute().data
        for r in rows:
            d = docs[r["document_id"]]
            for o in r["observations"]:
                out.append({**o, "doc_id": d["id"], "doc_url": d["url"], "doc_title": d["title"],
                            "doc_date": d["published_at"] or d["fetched_at"]})
    return out


def upsert_trends(sb: Client, trends: list[dict]) -> dict[str, str]:
    sb.table("trends").upsert(trends, on_conflict="slug").execute()
    rows = sb.table("trends").select("id,slug").execute().data
    return {r["slug"]: r["id"] for r in rows}


def insert_rows(sb: Client, table: str, rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for part in chunks(rows, 200):
        out.extend(sb.table(table).insert(part).execute().data)
    return out
