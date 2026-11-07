"""Recolección de documentos: HTTP educado (robots.txt + demora), RSS, links, HTML y PDF."""
from __future__ import annotations

import hashlib
import io
import logging
import re
import time
from datetime import datetime, timezone
from urllib import robotparser
from urllib.parse import urljoin, urlparse, urldefrag

import feedparser
import pdfplumber
import requests
import trafilatura
from bs4 import BeautifulSoup

from . import config

log = logging.getLogger(__name__)

_session = requests.Session()
_session.headers.update({"User-Agent": config.USER_AGENT, "Accept-Language": "es,en;q=0.8,pt;q=0.6"})
_robots: dict[str, robotparser.RobotFileParser | None] = {}
_last_request = 0.0
last_failure = ""   # motivo del último fallo de http_get (lo usa el probe)

RELEVANT_RE = re.compile(
    r"bovin|vacun|ganad|hacienda|rodeo|novill|ternero|vaquillona|invernada|faena|frigor[ií]fic|caravana|trazabilidad|pastura|feedlot|cattle|beef|livestock|carne|pecu[aá]ri|gado",
    re.I,
)
COMMON_FEED_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/feed.xml", "/index.xml", "/atom.xml"]
SKIP_LINK_RE = re.compile(r"(login|logout|signin|register|mailto:|tel:|javascript:|\.(jpg|jpeg|png|gif|svg|zip|xls|xlsx|doc|docx|mp4)$)", re.I)


def relevance_hits(text: str) -> int:
    return len(RELEVANT_RE.findall(text or ""))


def _allowed(url: str) -> bool:
    parts = urlparse(url)
    base = f"{parts.scheme}://{parts.netloc}"
    if base not in _robots:
        rp: robotparser.RobotFileParser | None = robotparser.RobotFileParser()
        try:
            r = _session.get(base + "/robots.txt", timeout=config.HTTP_TIMEOUT)
            if r.status_code == 200:
                rp.parse(r.text.splitlines())
            else:
                rp = None  # sin robots.txt: se permite
        except requests.RequestException:
            rp = None
        _robots[base] = rp
    rp = _robots[base]
    return True if rp is None else rp.can_fetch(config.USER_AGENT, url)


def http_get(url: str, check_robots: bool = True) -> requests.Response | None:
    """GET con demora de cortesía y respeto de robots.txt. Devuelve None si falla o está bloqueado."""
    global _last_request, last_failure
    last_failure = ""
    if check_robots and not _allowed(url):
        log.info("bloqueado por robots.txt: %s", url)
        last_failure = "robots.txt no permite el acceso"
        return None
    wait = config.REQUEST_DELAY - (time.time() - _last_request)
    if wait > 0:
        time.sleep(wait)
    try:
        r = _session.get(url, timeout=config.HTTP_TIMEOUT, allow_redirects=True)
        _last_request = time.time()
        if r.status_code != 200:
            log.info("HTTP %s en %s", r.status_code, url)
            last_failure = f"HTTP {r.status_code}"
            return None
        return r
    except requests.RequestException as e:
        _last_request = time.time()
        log.info("error de red en %s: %s", url, e)
        last_failure = f"error de red ({type(e).__name__})"
        return None


# ------------------------------------------------------------------ feeds
def feed_from_html(html: str, base_url: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    for link in soup.find_all("link", rel=lambda v: v and "alternate" in v, href=True):
        t = (link.get("type") or "").lower()
        if "rss" in t or "atom" in t:
            return urljoin(base_url, link["href"])
    return None


def discover_feed(base_url: str, html: str | None = None) -> str | None:
    """Busca un feed declarado en el HTML; si no, prueba rutas comunes."""
    if html:
        found = feed_from_html(html, base_url)
        if found:
            return found
    parts = urlparse(base_url)
    if parts.path not in ("", "/"):
        return None  # fuente dentro de un portal más grande: un feed en la raíz sería de todo el portal
    root = f"{parts.scheme}://{parts.netloc}"
    for path in COMMON_FEED_PATHS:
        r = http_get(root + path)
        if r is not None:
            parsed = feedparser.parse(r.content)
            if parsed.entries:
                return root + path
    return None


def _entry_date(entry) -> datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            return datetime(*t[:6], tzinfo=timezone.utc)
    return None


def feed_entries(feed_url: str, limit: int) -> list[dict]:
    r = http_get(feed_url)
    if r is None:
        return []
    parsed = feedparser.parse(r.content)
    out = []
    for e in parsed.entries[:limit]:
        if e.get("link"):
            out.append({"url": e["link"], "title": e.get("title"), "published_at": _entry_date(e)})
    return out


# ------------------------------------------------------------------ links
def candidate_links(page_url: str, html: str, limit: int, prefer_pdf: bool = False) -> list[dict]:
    """Links de una página que parecen notas o informes del tema (sin RSS)."""
    soup = BeautifulSoup(html, "html.parser")
    host = urlparse(page_url).netloc
    seen: set[str] = set()
    scored: list[tuple[int, int, dict]] = []
    for order, a in enumerate(soup.find_all("a", href=True)):
        url, _ = urldefrag(urljoin(page_url, a["href"]))
        if url in seen or url.rstrip("/") == page_url.rstrip("/") or SKIP_LINK_RE.search(url):
            continue
        is_pdf = ".pdf" in url.lower()
        if urlparse(url).netloc != host and not is_pdf:
            continue
        text = a.get_text(" ", strip=True)
        score = 0
        if RELEVANT_RE.search(text) or RELEVANT_RE.search(url):
            score += 3
        if len(text) > 25:
            score += 1
        if is_pdf:
            score += 2 if prefer_pdf else 1
        if score < 3:
            continue
        seen.add(url)
        scored.append((-score, order, {"url": url, "title": text or None, "published_at": None}))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [item for _, _, item in scored[:limit]]


# ------------------------------------------------------------------ documentos
def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def extract_document(url: str) -> dict | None:
    """Descarga una URL y devuelve {title, text, published_at, language, content_hash} o None."""
    r = http_get(url)
    if r is None:
        return None
    ctype = r.headers.get("content-type", "").lower()
    title: str | None = None
    published: datetime | None = None
    language: str | None = None

    if "pdf" in ctype or ".pdf" in url.lower():
        try:
            with pdfplumber.open(io.BytesIO(r.content)) as pdf:
                pages = pdf.pages[: config.MAX_PDF_PAGES]
                text = "\n".join((p.extract_text() or "") for p in pages)
                title = (pdf.metadata or {}).get("Title") or None
        except Exception as e:  # PDF corrupto o escaneado
            log.info("no se pudo leer PDF %s: %s", url, e)
            return None
    else:
        text = trafilatura.extract(r.text, include_comments=False, include_tables=True, favor_recall=True) or ""
        meta = trafilatura.extract_metadata(r.text)
        if meta:
            title = meta.title
            published = _parse_date(meta.date)
            language = getattr(meta, "language", None)

    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) < config.MIN_DOC_CHARS:
        return None
    text = text[: config.MAX_DOC_CHARS]
    return {
        "url": url,
        "title": title,
        "text": text,
        "published_at": published,
        "language": language,
        "content_hash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }
