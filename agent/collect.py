"""Recolecta documentos nuevos de una fuente: usa RSS si existe y, si no, links de la página."""
from __future__ import annotations

import logging

from . import config, fetch

log = logging.getLogger(__name__)


def collect_source(source: dict, find_known) -> tuple[list[dict], str | None]:
    """
    Devuelve (documentos_nuevos, feed_url_descubierto).
    `source` es una fila de la tabla sources. Los documentos incluyen 'text'.
    `find_known(urls) -> set[str]` indica cuáles URLs ya están guardadas (se saltean sin descargar).
    """
    limit = config.MAX_LINKS_PER_SOURCE
    home = fetch.http_get(source["url"])
    html = home.text if home is not None else None

    feed_url = None if source.get("no_feed") else source.get("feed_url")
    discovered: str | None = None
    entries: list[dict] = []

    # 1) Feed (declarado, o descubierto)
    if feed_url is None and not source.get("no_feed"):
        feed_url = fetch.discover_feed(source["url"], html)
        discovered = feed_url
    if feed_url:
        entries = fetch.feed_entries(feed_url, limit * 2)

    # 2) Sin feed: links de la página que parecen notas o informes
    if not entries and html:
        entries = fetch.candidate_links(
            source["url"], html, limit * 2, prefer_pdf=source["access_type"] == "pdf"
        )

    # 3) Página única (p. ej. una normativa): la propia página es el documento
    if not entries and html:
        entries = [{"url": source["url"], "title": None, "published_at": None}]

    if not entries:
        log.warning("[%s] sin entradas (feed ni links)", source["slug"])
        return [], discovered

    known_urls = find_known([e["url"] for e in entries])
    docs: list[dict] = []
    for entry in entries:
        if len(docs) >= limit:
            break
        if entry["url"] in known_urls:
            continue
        doc = fetch.extract_document(entry["url"])
        if doc is None:
            continue
        haystack = f"{doc.get('title') or ''} {doc['text'][:6000]}"
        if fetch.relevance_hits(haystack) < config.MIN_RELEVANCE_HITS:
            log.info("[%s] descartado por irrelevante: %s", source["slug"], entry["url"])
            continue
        doc["title"] = doc["title"] or entry.get("title")
        doc["published_at"] = doc["published_at"] or entry.get("published_at")
        docs.append(doc)
    log.info("[%s] %d documentos nuevos", source["slug"], len(docs))
    return docs, discovered
