"""Extracción de observaciones con Gemini. Cada observación debe traer una cita textual verificable."""
from __future__ import annotations

import logging
import re
import time
from typing import Literal, Optional

import yaml
from pydantic import BaseModel, Field

from . import config

log = logging.getLogger(__name__)

COUNTRY_ALIASES = {
    "ARGENTINA": "AR", "URUGUAY": "UY", "BRASIL": "BR", "BRAZIL": "BR", "AUSTRALIA": "AU",
    "USA": "US", "EEUU": "US", "EE.UU.": "US", "ESTADOS UNIDOS": "US", "PARAGUAY": "PY",
    "UE": "EU", "UNION EUROPEA": "EU", "UNIÓN EUROPEA": "EU", "CHINA": "CN",
}


class Observation(BaseModel):
    trend_slug: str = Field(description="Slug del catálogo, o uno nuevo en minúsculas con guiones")
    trend_name: str
    category: Literal["tecnologia", "mercado", "regulacion", "financiamiento"]
    summary_simple: str = Field(description="Una frase en lenguaje llano para un productor de campo")
    country_code: str = Field(description="País al que se refiere el dato (ISO-2; EU para Unión Europea)")
    horizon: Literal["hoy", "corto", "mediano", "largo"]
    adoption_pct: Optional[float] = Field(default=None, description="0-100, solo si el texto lo da explícitamente")
    adoption_note: Optional[str] = None
    confidence: float = Field(description="0 a 1")
    rationale: str
    quote: str = Field(description="Cita textual EXACTA del documento (máx. 300 caracteres)")
    supports: Literal["adopcion", "horizonte", "referencia"]


class ExtractionResult(BaseModel):
    observations: list[Observation]


def load_taxonomy() -> list[dict]:
    with open(config.ROOT / "taxonomy.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)["trends"]


def build_prompt(doc: dict, taxonomy: list[dict]) -> str:
    catalog = "\n".join(f"- {t['slug']}: {t['name']}" for t in taxonomy)
    text = doc["content_text"][: config.ANALYZE_CHARS]
    return f"""Sos un analista de la industria de ganadería bovina de carne. Del documento de abajo extraé
observaciones sobre tendencias tecnológicas, de mercado, regulatorias o de financiamiento.

CATÁLOGO DE TENDENCIAS (reutilizá el slug si es el mismo concepto; si no encaja, proponé uno nuevo):
{catalog}

REGLAS
- Usá SOLO lo que está explícito en el texto. No agregues conocimiento propio.
- quote: copia textual EXACTA del documento (máx. 300 caracteres) que respalda la observación. Si no hay cita, no incluyas la observación.
- country_code: país al que se refiere el dato, no el país de la fuente. ISO-2 (AR, UY, BR, AU, US...), EU para la Unión Europea.
- horizon: "hoy" si describe la práctica actual; "corto" (0-2 años), "mediano" (2-5) o "largo" (5+) si el texto proyecta, anuncia o espera algo.
- adoption_pct: solo si el texto da un porcentaje explícito de adopción o penetración (o los números para calcularlo directamente). Si no, null. En adoption_note aclará a qué se refiere el porcentaje.
- confidence: 0.8 o más si es un dato explícito de fuente oficial; ~0.5 si es indirecto; menos de 0.4 si es débil.
- supports: "adopcion" (nivel actual), "horizonte" (cuándo llegaría), "referencia" (dato de un país usado como comparación).
- summary_simple: una frase en lenguaje llano, sin jerga.
- rationale: una frase que explique cómo el texto lleva a esta observación.
- Máximo 8 observaciones. Si el documento no aporta nada relevante, devolvé una lista vacía.

DOCUMENTO
Título: {doc.get('title') or '(sin título)'}
URL: {doc['url']}
Texto:
{text}
"""


def _norm(s: str) -> str:
    s = s.lower().replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", s).strip()


def verify_quote(quote: str, source_text: str) -> bool:
    q = _norm(quote)
    return len(q) >= 15 and q in _norm(source_text)


def normalize_country(code: str) -> str | None:
    c = (code or "").strip().upper()
    c = COUNTRY_ALIASES.get(c, c)
    return c if re.fullmatch(r"[A-Z]{2}", c) else None


def slugify(s: str) -> str:
    s = _norm(s)
    s = (s.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o")
          .replace("ú", "u").replace("ñ", "n"))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:80]


def clean_observations(result: ExtractionResult, doc_text: str) -> tuple[list[dict], int]:
    """Valida, normaliza y descarta lo que no se puede verificar. Devuelve (observaciones, descartadas)."""
    kept, dropped = [], 0
    for o in result.observations:
        country = normalize_country(o.country_code)
        slug = slugify(o.trend_slug) or slugify(o.trend_name)
        if not country or not slug or not verify_quote(o.quote, doc_text):
            dropped += 1
            continue
        d = o.model_dump()
        d["country_code"] = country
        d["trend_slug"] = slug
        d["confidence"] = max(0.0, min(1.0, d["confidence"]))
        if d["adoption_pct"] is not None:
            d["adoption_pct"] = max(0.0, min(100.0, d["adoption_pct"]))
        kept.append(d)
    return kept, dropped


_client = None


def _gemini():
    global _client
    if _client is None:
        from google import genai
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


_dead: set[str] = set()   # modelos agotados o inexistentes durante esta corrida


def extract(doc: dict, taxonomy: list[dict]) -> tuple[list[dict], int, str]:
    """
    Llama a Gemini probando los modelos de config.GEMINI_MODELS en orden.
    Devuelve (observaciones verificadas, descartadas, modelo usado).
    """
    from google.genai import types

    prompt = build_prompt(doc, taxonomy)
    last_err: Exception | None = None
    for model in config.GEMINI_MODELS:
        if model in _dead:
            continue
        for attempt in (1, 2):
            try:
                resp = _gemini().models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=ExtractionResult,
                        temperature=0.1,
                    ),
                )
                result = resp.parsed
                if result is None:
                    result = ExtractionResult.model_validate_json(resp.text)
                obs, dropped = clean_observations(result, doc["content_text"])
                return obs, dropped, model
            except Exception as e:
                msg, last_err = str(e), e
                if "404" in msg or "NOT_FOUND" in msg:
                    log.warning("modelo %s no disponible; paso al siguiente", model)
                    _dead.add(model)
                    break
                if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                    if attempt == 1:
                        log.warning("modelo %s limitado; espero 20 s y reintento", model)
                        time.sleep(20)
                        continue
                    log.warning("modelo %s sin cuota por hoy; paso al siguiente", model)
                    _dead.add(model)
                    break
                if any(k in msg for k in ("503", "UNAVAILABLE", "500", "Timeout", "timed out")):
                    if attempt == 1:
                        time.sleep(10)
                        continue
                    break  # se prueba el siguiente modelo, sin descartar este para otros documentos
                raise
    raise RuntimeError(f"ningún modelo de Gemini disponible (cuota agotada o error): {last_err}")
