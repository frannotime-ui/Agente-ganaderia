"""
Sondea cada fuente de sources.yaml:  python -m agent.probe

Para cada una informa si responde, si hay feed RSS/Atom, cuántos links candidatos
encuentra y si robots.txt la bloquea. Guarda probe_report.json.
No necesita Supabase ni Gemini: sirve para validar las fuentes antes de la primera corrida.
"""
from __future__ import annotations

import json
import sys

import yaml

from . import config, fetch


def probe(source: dict) -> dict:
    res = {"slug": source["slug"], "url": source["url"], "status": "ok", "feed": None, "links": 0, "note": ""}
    if not fetch._allowed(source["url"]):
        res.update(status="bloqueada", note="robots.txt no permite el acceso automatizado")
        return res
    home = fetch.http_get(source["url"])
    if home is None:
        res.update(status="sin_respuesta", note=fetch.last_failure or "no respondió")
        return res
    res["feed"] = fetch.discover_feed(source["url"], home.text)
    links = fetch.candidate_links(source["url"], home.text, 50, prefer_pdf=source["access"] == "pdf")
    res["links"] = len(links)
    if not res["feed"] and not links:
        res.update(status="sin_contenido", note="sin feed ni links relevantes; probablemente requiere JavaScript o una URL más específica")
    return res


def main() -> None:
    with open(config.ROOT / "sources.yaml", encoding="utf-8") as f:
        sources = yaml.safe_load(f)["sources"]
    report = []
    for s in sources:
        r = probe(s)
        report.append(r)
        print(f"{r['status']:<14} {r['slug']:<18} feed={'sí' if r['feed'] else 'no':<3} links={r['links']:<3} {r['note']}")
    out = config.ROOT / "probe_report.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    ok = sum(1 for r in report if r["status"] == "ok")
    print(f"\n{ok}/{len(report)} fuentes utilizables. Detalle en {out.name}")
    sys.exit(0)


if __name__ == "__main__":
    main()
