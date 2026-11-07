"""Tests sin red ni base de datos:  python -m tests.test_logic"""
from agent import analyze, fetch, snapshot
from agent.analyze import ExtractionResult, Observation


def obs(**kw):
    base = dict(trend_slug="trazabilidad-electronica", trend_name="Trazabilidad", category="tecnologia",
                summary_simple="x", country_code="AR", horizon="hoy", adoption_pct=None, adoption_note=None,
                confidence=0.8, rationale="r", quote="el 30% del rodeo usa caravana electronica", supports="adopcion")
    base.update(kw)
    return Observation(**base)


def test_quote_verification():
    text = "En 2025,  el 30% del rodeo\nusa caravana electronica en el pais."
    assert analyze.verify_quote("el 30% del rodeo usa caravana electronica", text)
    assert not analyze.verify_quote("el 80% del rodeo usa caravana electronica", text)
    assert not analyze.verify_quote("corta", "corta")  # demasiado corta para ser evidencia


def test_clean_observations_drops_unverifiable_and_normalizes():
    text = "el 30% del rodeo usa caravana electronica"
    res = ExtractionResult(observations=[
        obs(country_code="Argentina", adoption_pct=130, confidence=1.4),
        obs(quote="cita inventada que no esta en el documento"),
        obs(country_code="Narnia"),
    ])
    kept, dropped = analyze.clean_observations(res, text)
    assert len(kept) == 1 and dropped == 2
    assert kept[0]["country_code"] == "AR" and kept[0]["adoption_pct"] == 100 and kept[0]["confidence"] == 1


def test_slugify():
    assert analyze.slugify("Ganadería de Precisión!") == "ganaderia-de-precision"


def as_dict(o, doc="d1", date="2026-01-01"):
    d = o.model_dump()
    d.update(doc_id=doc, doc_date=date)
    return d


def test_aggregate_and_gaps():
    rows = [
        as_dict(obs(country_code="AR", adoption_pct=20, confidence=0.9), "a"),
        as_dict(obs(country_code="AR", adoption_pct=35, confidence=0.5), "b"),   # menor confianza: pierde
        as_dict(obs(country_code="UY", adoption_pct=95, confidence=0.9), "c"),
        as_dict(obs(country_code="AU", adoption_pct=99, confidence=0.2), "d"),   # confianza baja: no es referencia
        as_dict(obs(country_code="AR", horizon="mediano"), "e"),
    ]
    statuses = snapshot.aggregate(rows)
    assert len(statuses) == 4
    gaps = snapshot.compute_gaps(statuses)
    assert len(gaps) == 1
    g = gaps[0]
    assert (g["current_pct"], g["reference_pct"], g["reference_country"]) == (20, 95, "UY")
    assert g["confidence"] == 0.9


def test_no_gap_without_reference():
    statuses = snapshot.aggregate([as_dict(obs(country_code="AR", adoption_pct=20))])
    assert snapshot.compute_gaps(statuses) == []


def test_candidate_links_and_feed_discovery():
    html = """<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>
    <a href="/notas/trazabilidad-ganado-bovino-nueva-norma">Nueva norma de trazabilidad para ganado bovino</a>
    <a href="/login">Ingresar</a><a href="/contacto">Contacto</a>
    <a href="/docs/informe-ganaderia.pdf">Informe ganadería 2026</a>
    <a href="https://otro-sitio.com/nota-ganado">Nota externa sobre ganado</a></body></html>"""
    assert fetch.feed_from_html(html, "https://sitio.com/") == "https://sitio.com/feed.xml"
    links = fetch.candidate_links("https://sitio.com/", html, 10)
    urls = [l["url"] for l in links]
    assert "https://sitio.com/notas/trazabilidad-ganado-bovino-nueva-norma" in urls
    assert "https://sitio.com/docs/informe-ganaderia.pdf" in urls
    assert all("login" not in u and "otro-sitio" not in u for u in urls)


def test_prompt_contains_catalog_and_rules():
    p = analyze.build_prompt({"url": "u", "title": "t", "content_text": "texto"}, analyze.load_taxonomy())
    assert "trazabilidad-electronica" in p and "EXACTA" in p


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
