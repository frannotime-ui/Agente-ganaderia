/* Monitor ganadero. Sin dependencias de compilación: abrir index.html alcanza.
   Todo texto que viene de la base se escapa (esc) antes de mostrarse. */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const HOME = 'AR';
  const LEVELS = ['sin_adopcion', 'incipiente', 'en_expansion', 'generalizada'];
  const LEVEL_LABEL = { sin_adopcion: 'Sin adopción', incipiente: 'Incipiente', en_expansion: 'En expansión', generalizada: 'Generalizada' };
  const LEVEL_HELP = {
    sin_adopcion: 'No existe o es algo excepcional.',
    incipiente: 'Hay pruebas piloto o recién empieza.',
    en_expansion: 'Crece y ya lo usa una parte importante.',
    generalizada: 'Es lo normal o ya es obligatorio.',
  };
  const CATEGORY_LABEL = { tecnologia: 'Tecnología', mercado: 'Mercado', regulacion: 'Normas y exigencias', financiamiento: 'Financiamiento' };
  const HORIZONS = [
    { key: 'corto', title: 'Pronto', range: 'hasta 2 años' },
    { key: 'mediano', title: 'En unos años', range: 'de 2 a 5 años' },
    { key: 'largo', title: 'Más adelante', range: 'más de 5 años' },
  ];
  const SUPPORT_LABEL = {
    adopcion: 'Respalda el nivel actual',
    horizonte: 'Respalda lo que se espera a futuro',
    referencia: 'Respalda la comparación con otro país',
  };

  // Códigos ISO numéricos (los usa el mapa). EU = Unión Europea (todos sus miembros).
  const ISO_NUM = {
    AR: 32, UY: 858, BR: 76, AU: 36, US: 840, PY: 600, CL: 152, BO: 68, PE: 604, CO: 170, EC: 218, VE: 862, GY: 328,
    MX: 484, CA: 124, CN: 156, NZ: 554, ZA: 710, IN: 356, JP: 392, KR: 410, GB: 826, RU: 643, VN: 704, ID: 360,
    TH: 764, SA: 682, AE: 784, EG: 818, TR: 792, UA: 804, KZ: 398, NG: 566, KE: 404, ET: 231, IL: 376, CH: 756, NO: 578,
  };
  const EU_NUM = [40, 56, 100, 191, 196, 203, 208, 233, 246, 250, 276, 300, 348, 372, 380, 428, 440, 442, 470, 528, 616, 620, 642, 703, 705, 724, 752];
  const SA_NUM = [32, 68, 76, 152, 170, 218, 328, 600, 604, 740, 858, 862];
  const NUM_TO_CODE = new Map();
  Object.entries(ISO_NUM).forEach(([c, n]) => NUM_TO_CODE.set(n, c));
  EU_NUM.forEach(n => NUM_TO_CODE.set(n, 'EU'));

  const state = { data: null, tab: 'hoy', cat: 'todas', mapView: 'world', selected: null, stack: [], lastFocus: null };

  // ------------------------------------------------------------ utilidades
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);
  const regionNames = (() => { try { return new Intl.DisplayNames(['es'], { type: 'region' }); } catch (e) { return null; } })();
  const COUNTRY_OVERRIDE = { EU: 'Unión Europea', US: 'Estados Unidos' };
  const countryName = c => COUNTRY_OVERRIDE[c] || (regionNames && (() => { try { return regionNames.of(c); } catch (e) { return null; } })()) || c;
  const rank = l => LEVELS.indexOf(l);
  const fmtDate = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const confLabel = c => (c >= 0.75 ? 'alta' : c >= 0.5 ? 'media' : 'baja');
  const plural = (n, one, many) => (n === 1 ? one : many);

  function meter(level) {
    const n = rank(level);
    const label = n < 0 ? 'Nivel sin clasificar' : 'Nivel: ' + LEVEL_LABEL[level].toLowerCase();
    return '<span class="meter' + (n < 0 ? ' unk' : '') + '" role="img" aria-label="' + esc(label) + '">' +
      [1, 2, 3].map(i => '<i' + (i <= n ? ' class="on"' : '') + '></i>').join('') + '</span>';
  }

  // ------------------------------------------------------------ datos
  async function sbFetch(path, headers) {
    const r = await fetch(CFG.SUPABASE_URL + '/rest/v1/' + path, { headers: Object.assign({ apikey: CFG.SUPABASE_KEY }, headers || {}) });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300));
    return r;
  }

  async function loadFromSupabase() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) throw new Error('Falta configurar config.js');
    const latest = await (await sbFetch('trend_status?select=run_id,created_at&order=created_at.desc&limit=1')).json();
    const catalog = await (await sbFetch('trends?select=id,slug,name,summary_simple,category')).json();
    const trends = catalog.map(t => ({ id: t.id, slug: t.slug, name: t.name, summary: t.summary_simple, category: t.category }));

    let docs = null;
    try {
      const r = await sbFetch('documents?select=id&limit=1', { Prefer: 'count=exact' });
      docs = Number((r.headers.get('content-range') || '').split('/')[1]) || null;
    } catch (e) { /* el conteo es opcional */ }

    if (!latest.length) return { meta: { updatedAt: null, docs }, trends, statuses: [], gaps: [], evidence: [] };

    const runId = latest[0].run_id;
    const stRows = await (await sbFetch('trend_status?run_id=eq.' + runId +
      '&select=id,trend_id,country_code,horizon,adoption_level,adoption_pct,adoption_note,confidence,rationale,created_at&limit=2000')).json();
    const statuses = stRows.map(s => ({
      id: s.id, trendId: s.trend_id, country: s.country_code, horizon: s.horizon, level: s.adoption_level,
      pct: s.adoption_pct, note: s.adoption_note, confidence: Number(s.confidence), rationale: s.rationale,
    }));
    const since = new Date(Math.min.apply(null, stRows.map(s => new Date(s.created_at).getTime())) - 60000).toISOString();

    const [gapRows, evRows] = await Promise.all([
      sbFetch('gaps?run_id=eq.' + runId + '&select=id,trend_id,current_level,reference_level,gap_levels,current_pct,reference_pct,reference_country,confidence,rationale&limit=1000').then(r => r.json()),
      sbFetch('evidence?select=trend_id,trend_status_id,gap_id,quote,supports,documents(url,title,published_at,fetched_at,sources(name))' +
        '&created_at=gte.' + encodeURIComponent(since) + '&order=created_at.desc&limit=3000').then(r => r.json()),
    ]);
    const gaps = gapRows.map(g => ({
      id: g.id, trendId: g.trend_id, currentLevel: g.current_level, referenceLevel: g.reference_level, gapLevels: g.gap_levels,
      refCountry: g.reference_country, currentPct: g.current_pct, refPct: g.reference_pct, confidence: Number(g.confidence), rationale: g.rationale,
    }));
    const statusIds = new Set(statuses.map(s => s.id));
    const gapIds = new Set(gaps.map(g => g.id));
    const seen = new Set();
    const evidence = [];
    evRows.forEach(e => {
      if (!(statusIds.has(e.trend_status_id) || gapIds.has(e.gap_id))) return;
      const d = e.documents || {};
      const key = e.trend_id + '|' + e.quote;
      if (seen.has(key + '|' + e.supports)) return;
      seen.add(key + '|' + e.supports);
      evidence.push({
        trendId: e.trend_id, statusId: e.trend_status_id, gapId: e.gap_id, quote: e.quote, supports: e.supports,
        url: d.url, title: d.title, date: d.published_at || d.fetched_at, source: d.sources && d.sources.name,
      });
    });
    return { meta: { updatedAt: latest[0].created_at, docs }, trends, statuses, gaps, evidence };
  }

  // ------------------------------------------------------------ consultas sobre los datos
  const D = () => state.data;
  const trendById = id => D().trends.find(t => t.id === id);
  const inCat = t => state.cat === 'todas' || (t && t.category === state.cat);
  const bestStatus = (trendId, country, horizon) =>
    D().statuses.filter(s => s.trendId === trendId && s.country === country && s.horizon === horizon)
      .sort((a, b) => b.confidence - a.confidence)[0];
  const countriesWithData = () => [...new Set(D().statuses.map(s => s.country))];

  // ------------------------------------------------------------ portada
  function heroSentence() {
    const d = D();
    if (!d.statuses.length) {
      return { h: 'Todavía no hay datos cargados.', p: 'Cuando el agente termine su primera corrida, acá vas a ver cómo está la ganadería argentina frente al resto.' };
    }
    const comparable = d.gaps.length;
    if (!comparable) {
      return {
        h: 'Todavía no hay datos suficientes para comparar a Argentina con otros países.',
        p: 'Ya hay ' + new Set(d.statuses.map(s => s.trendId)).size + ' tendencias con información. Falta que las fuentes digan en qué nivel está cada país.',
      };
    }
    const late = d.gaps.filter(g => g.gapLevels > 0).sort((a, b) => b.gapLevels - a.gapLevels || b.confidence - a.confidence);
    const h = 'Argentina está atrasada en ' + late.length + ' de ' + comparable + ' ' + plural(comparable, 'tendencia comparable', 'tendencias que se pueden comparar') + ' con otros países.';
    let p;
    if (late.length) {
      const top = late[0];
      p = 'El mayor atraso: ' + (trendById(top.trendId) || {}).name + ', frente a ' + countryName(top.refCountry) + '.';
    } else {
      p = 'En el resto va al día o adelante.';
    }
    return { h, p };
  }

  function renderHero() {
    const d = D();
    const { h, p } = heroSentence();
    const countries = countriesWithData();
    const nTrends = new Set(d.statuses.map(s => s.trendId)).size;
    const nQuotes = d.evidence.length;
    const facts = [
      '<li><strong>' + nTrends + '</strong> ' + plural(nTrends, 'tendencia seguida', 'tendencias seguidas') + '</li>',
      '<li><strong>' + countries.length + '</strong> ' + plural(countries.length, 'país con información', 'países con información') + '</li>',
      d.meta.docs ? '<li><strong>' + d.meta.docs + '</strong> notas e informes leídos</li>' : '',
      nQuotes ? '<li><strong>' + nQuotes + '</strong> citas para verificar</li>' : '',
    ].join('');
    $('#hero').innerHTML =
      '<div><h1>' + esc(h) + '</h1><p class="lead">' + esc(p) + '</p>' +
      '<p class="howto">Tocá un país en el mapa o una tendencia para ver de dónde sale cada dato.</p>' +
      '<ul class="facts">' + facts + '</ul></div>' +
      '<div class="mapbox"><div class="mapbar"><h2>Países con información</h2>' +
      '<div class="seg" role="group" aria-label="Zona del mapa">' +
      '<button type="button" data-mapview="world" aria-pressed="' + (state.mapView === 'world') + '">Mundo</button>' +
      '<button type="button" data-mapview="sa" aria-pressed="' + (state.mapView === 'sa') + '">Sudamérica</button></div></div>' +
      '<div id="map"></div><p class="mapnote">Los países en verde tienen datos. Tocá uno para ver cómo está.</p>' +
      '<div class="chips" id="country-chips"></div></div>';
    drawMap();
    renderCountryChips();
  }

  function numsFor(code) { return code === 'EU' ? EU_NUM : (ISO_NUM[code] ? [ISO_NUM[code]] : []); }

  function drawMap() {
    const box = $('#map');
    if (!box) return;
    if (!(window.d3 && window.topojson && window.WORLD_110M)) { box.innerHTML = ''; return; }
    const world = window.WORLD_110M;
    const feats = topojson.feature(world, world.objects.countries).features.filter(f => Number(f.id) !== 10);
    const W = 640, H = 340;
    const fit = state.mapView === 'sa'
      ? { type: 'FeatureCollection', features: feats.filter(f => SA_NUM.includes(Number(f.id))) }
      : { type: 'FeatureCollection', features: feats };
    const proj = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], fit);
    const path = d3.geoPath(proj);
    const active = new Set(countriesWithData());
    const paths = feats.map(f => {
      const code = NUM_TO_CODE.get(Number(f.id));
      const on = code && active.has(code);
      const sel = on && code === state.selected;
      const attrs = on ? ' data-country="' + code + '" tabindex="0" role="button" aria-label="' + esc(countryName(code)) + ': ver cómo está"' : '';
      return '<path class="land' + (on ? ' has' : '') + (sel ? ' sel' : '') + '"' + attrs + ' d="' + (path(f) || '') + '">' +
        (on ? '<title>' + esc(countryName(code)) + '</title>' : '') + '</path>';
    }).join('');
    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="Mapa de países con información">' + paths + '</svg>';
  }

  function renderCountryChips() {
    const el = $('#country-chips');
    if (!el) return;
    const counts = {};
    D().statuses.forEach(s => { counts[s.country] = (counts[s.country] || new Set()).add(s.trendId); });
    const codes = Object.keys(counts).sort((a, b) => (a === HOME ? -1 : b === HOME ? 1 : countryName(a).localeCompare(countryName(b), 'es')));
    el.innerHTML = codes.map(c =>
      '<button type="button" class="chip" data-open-country="' + c + '" aria-pressed="' + (state.selected === c) + '">' +
      esc(countryName(c)) + ' <small>' + counts[c].size + '</small></button>').join('');
  }

  // ------------------------------------------------------------ secciones
  function legendHtml() {
    return '<details class="legend"><summary>¿Qué significa cada nivel?</summary><ul>' +
      LEVELS.map(l => '<li>' + meter(l) + '<span><b>' + LEVEL_LABEL[l] + '</b>' + LEVEL_HELP[l] + '</span></li>').join('') + '</ul></details>';
  }

  function toolbarHtml() {
    const cats = ['todas', 'tecnologia', 'mercado', 'regulacion', 'financiamiento'];
    return '<div class="toolbar" role="group" aria-label="Filtrar por tema"><span class="label">Tema:</span>' +
      cats.map(c => '<button type="button" class="chip" data-cat="' + c + '" aria-pressed="' + (state.cat === c) + '">' +
        (c === 'todas' ? 'Todos' : CATEGORY_LABEL[c]) + '</button>').join('') + '</div>';
  }

  function viewHoy() {
    const d = D();
    const rows = d.trends.filter(inCat).map(t => ({ t, s: bestStatus(t.id, HOME, 'hoy') }));
    const withData = rows.filter(r => r.s).sort((a, b) => rank(b.s.level) - rank(a.s.level) || a.t.name.localeCompare(b.t.name, 'es'));
    const without = rows.filter(r => !r.s);
    let html = '<h2>Qué está pasando hoy en Argentina</h2>' +
      '<p class="sub">Qué tan extendida está cada tendencia, según lo que dicen las fuentes. Tocá una para ver las citas.</p>' + legendHtml();
    if (!withData.length) {
      html += '<div class="notice"><h3>Todavía no hay datos de Argentina en este tema</h3><p>Probá con otro tema o esperá la próxima actualización del agente.</p></div>';
    } else {
      html += '<div class="list">' + withData.map(({ t, s }) =>
        '<button type="button" class="row" data-open-trend="' + t.id + '">' +
        '<span>' + meter(s.level) + '</span>' +
        '<span class="row-main"><strong>' + esc(t.name) + '</strong><span class="muted">' + esc(t.summary) + '</span></span>' +
        '<span class="row-side"><span class="level">' + (s.level ? LEVEL_LABEL[s.level] : 'Sin clasificar') + '</span>' +
        '<span class="conf">Confianza ' + confLabel(s.confidence) + '</span></span></button>').join('') + '</div>';
    }
    if (without.length) {
      html += '<details class="nodata"><summary>Tendencias que seguimos y todavía no tienen datos de Argentina (' + without.length + ')</summary><ul>' +
        without.map(r => '<li>' + esc(r.t.name) + '</li>').join('') + '</ul></details>';
    }
    return html;
  }

  function viewViene() {
    const d = D();
    let html = '<h2>Qué puede venir</h2><p class="sub">Lo que las fuentes anticipan para los próximos años. Tocá una tendencia para ver quién lo dice y dónde.</p>';
    html += '<div class="horizons">' + HORIZONS.map(h => {
      const byTrend = new Map();
      d.statuses.filter(s => s.horizon === h.key).forEach(s => {
        const t = trendById(s.trendId);
        if (!t || !inCat(t)) return;
        if (!byTrend.has(t.id)) byTrend.set(t.id, []);
        byTrend.get(t.id).push(s);
      });
      const items = [...byTrend.entries()].map(([id, list]) => {
        list.sort((a, b) => b.confidence - a.confidence);
        return { t: trendById(id), list };
      }).sort((a, b) => b.list[0].confidence - a.list[0].confidence);
      return '<div class="horizon"><header><h3>' + h.title + '</h3><span class="muted small">' + h.range + '</span></header>' +
        (items.length ? items.map(({ t, list }) =>
          '<button type="button" class="future" data-open-trend="' + t.id + '"><strong>' + esc(t.name) + '</strong>' +
          '<span class="where">' + [...new Set(list.map(s => countryName(s.country)))].map(esc).join(', ') + '</span>' +
          '<span class="why">' + esc(list[0].rationale) + '</span></button>').join('')
          : '<p class="empty-col">Sin novedades en este plazo.</p>') + '</div>';
    }).join('') + '</div>';
    return html;
  }

  function gapTag(g) {
    if (g.gapLevels >= 2) return { cls: 'late-2', text: g.gapLevels + ' niveles de atraso' };
    if (g.gapLevels === 1) return { cls: 'late-1', text: 'Un nivel de atraso' };
    if (g.gapLevels === 0) return { cls: 'ok', text: 'Al día' };
    return { cls: 'ok', text: 'Argentina va adelante' };
  }

  function viewBrechas() {
    const d = D();
    const gaps = d.gaps.filter(g => inCat(trendById(g.trendId)))
      .sort((a, b) => b.gapLevels - a.gapLevels || b.confidence - a.confidence);
    let html = '<h2>Dónde estamos atrasados</h2>' +
      '<p class="sub">Comparamos el nivel de Argentina con el del país más avanzado que tenga datos confiables en cada tendencia.</p>' + legendHtml();
    if (!gaps.length) {
      html += '<div class="notice"><h3>Todavía no hay brechas para mostrar</h3>' +
        '<p>Para comparar hace falta que las fuentes den el nivel de una tendencia en Argentina y en al menos otro país. A medida que el agente lea más notas, esta sección se completa.</p>' +
        (state.data.meta.demo ? '' : '<a class="btn ghost" href="?demo=1">Ver cómo se vería con datos de ejemplo</a>') + '</div>';
      return html;
    }
    html += '<div class="gaps">' + gaps.map(g => {
      const t = trendById(g.trendId) || { name: '?', summary: '' };
      const tag = gapTag(g);
      return '<button type="button" class="gap ' + tag.cls + '" data-open-trend="' + g.trendId + '">' +
        '<span class="gap-head"><strong>' + esc(t.name) + '</strong><span class="tag ' + tag.cls + '">' + tag.text + '</span></span>' +
        '<span class="gap-compare">' +
        '<span class="who">' + meter(g.currentLevel) + '<span class="txt"><b>' + countryName(HOME) + '</b><small>' + LEVEL_LABEL[g.currentLevel] + '</small></span></span>' +
        '<span class="who">' + meter(g.referenceLevel) + '<span class="txt"><b>' + esc(countryName(g.refCountry)) + '</b><small>' + LEVEL_LABEL[g.referenceLevel] + '</small></span></span></span>' +
        '<span class="muted">' + esc(t.summary) + '</span></button>';
    }).join('') + '</div>';
    return html;
  }

  function renderPanel() {
    const view = state.tab === 'hoy' ? viewHoy() : state.tab === 'viene' ? viewViene() : viewBrechas();
    $('#panel').innerHTML = toolbarHtml() + view;
    document.querySelectorAll('.tabs button').forEach(b => {
      const on = b.dataset.tab === state.tab;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      if (on) $('#panel').setAttribute('aria-labelledby', b.id);
    });
  }

  function renderFooter() {
    $('#pie').innerHTML =
      '<details><summary>Cómo se calcula esto</summary>' +
      '<p>Un agente de inteligencia artificial lee noticias, informes y normas de fuentes públicas del sector y extrae las tendencias. ' +
      'Cada dato lleva una cita textual de la nota de donde sale, para que cualquiera pueda verificarlo.</p>' +
      '<ul><li>El nivel de adopción (sin adopción, incipiente, en expansión o generalizada) es una estimación a partir de lo que dice cada fuente. No es un censo.</li>' +
      '<li>La brecha compara a Argentina con el país más avanzado que tenga datos confiables en esa tendencia.</li>' +
      '<li>Hoy las brechas son nacionales: todavía no distinguen por región, tamaño del rodeo ni etapa productiva.</li>' +
      '<li>Si una fuente no dice algo, no lo inventamos: la tendencia queda sin dato.</li></ul></details>';
  }

  function renderStamp() {
    const d = D();
    $('#stamp').textContent = d.meta.updatedAt ? 'Actualizado el ' + fmtDate(d.meta.updatedAt) : '';
    $('#demo-banner').innerHTML = d.meta.demo
      ? '<div class="demo-banner" role="note">Estás viendo datos de ejemplo para mostrar cómo funciona. No son datos reales. <a href="' + location.pathname + '">Ver datos reales</a></div>' : '';
  }

  function renderAll() { renderStamp(); renderHero(); renderPanel(); renderFooter(); }

  // ------------------------------------------------------------ panel de detalle
  function evidenceHtml(list) {
    if (!list.length) return '<p class="muted">Todavía no hay citas guardadas para este punto.</p>';
    return list.slice(0, 14).map(e => {
      const url = safeUrl(e.url);
      const meta = [e.source, fmtDate(e.date)].filter(Boolean).map(esc).join(', ');
      return '<figure class="ev"><blockquote>“' + esc(e.quote) + '”</blockquote><figcaption>' +
        '<span class="kind">' + (SUPPORT_LABEL[e.supports] || '') + '</span>' +
        (e.title ? esc(e.title) + '. ' : '') + (meta ? 'Fuente: ' + meta + '. ' : '') +
        (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Abrir la nota</a>' : '') + '</figcaption></figure>';
    }).join('');
  }

  function trendDrawer(id) {
    const d = D();
    const t = trendById(id);
    if (!t) return '<p>No encontramos esta tendencia.</p>';
    const sts = d.statuses.filter(s => s.trendId === id);
    const countries = [...new Set(sts.map(s => s.country))].sort((a, b) => (a === HOME ? -1 : b === HOME ? 1 : countryName(a).localeCompare(countryName(b), 'es')));
    const gap = d.gaps.find(g => g.trendId === id);
    let html = '<span class="cat">' + esc(CATEGORY_LABEL[t.category] || t.category) + '</span><h2 id="drawer-title">' + esc(t.name) + '</h2>' +
      '<p class="muted" style="margin-top:.5rem">' + esc(t.summary) + '</p>';
    if (gap) {
      const tag = gapTag(gap);
      html += '<div class="diffbox"><span class="tag ' + tag.cls + '">' + tag.text + '</span> ' +
        '<p style="margin-top:.5rem">Argentina: <b>' + LEVEL_LABEL[gap.currentLevel].toLowerCase() + '</b>. ' +
        esc(countryName(gap.refCountry)) + ': <b>' + LEVEL_LABEL[gap.referenceLevel].toLowerCase() + '</b>.' +
        (gap.currentPct != null && gap.refPct != null ? ' (' + gap.currentPct + '% frente a ' + gap.refPct + '%)' : '') + '</p></div>';
    }
    html += '<h3>Cómo está en cada país</h3>';
    if (!countries.length) html += '<p class="muted">Todavía no hay datos de esta tendencia.</p>';
    countries.forEach(c => {
      const hoy = bestStatus(id, c, 'hoy');
      const fut = HORIZONS.map(h => ({ h, s: bestStatus(id, c, h.key) })).filter(x => x.s);
      html += '<div class="cty"><div class="cty-head"><button type="button" class="linklike" data-open-country="' + c + '">' + esc(countryName(c)) + '</button>' +
        (hoy ? meter(hoy.level) + '<span class="level">' + (hoy.level ? LEVEL_LABEL[hoy.level] : 'Sin clasificar') + '</span>' +
          '<span class="conf">Confianza ' + confLabel(hoy.confidence) + '</span>' : '') + '</div>' +
        (hoy ? '<p class="small muted">' + esc(hoy.rationale) + (hoy.pct != null ? ' (' + hoy.pct + '%' + (hoy.note ? ' ' + esc(hoy.note) : '') + ')' : '') + '</p>' : '') +
        fut.map(x => '<p class="fut"><b>' + x.h.title + ' (' + x.h.range + '):</b> ' + esc(x.s.rationale) + '</p>').join('') + '</div>';
    });
    const ev = d.evidence.filter(e => e.trendId === id);
    html += '<h3>De dónde sale</h3>' + evidenceHtml(ev);
    return html;
  }

  function countryDrawer(code) {
    const d = D();
    const sts = d.statuses.filter(s => s.country === code);
    const ids = [...new Set(sts.map(s => s.trendId))];
    const rows = ids.map(id => ({ t: trendById(id), hoy: bestStatus(id, code, 'hoy'), ar: bestStatus(id, HOME, 'hoy') }))
      .filter(r => r.t).sort((a, b) => rank(b.hoy && b.hoy.level) - rank(a.hoy && a.hoy.level) || a.t.name.localeCompare(b.t.name, 'es'));
    let html = '<h2 id="drawer-title">' + esc(countryName(code)) + '</h2>' +
      '<p class="muted" style="margin-top:.5rem">' + (code === HOME
        ? 'Cómo está cada tendencia en Argentina.'
        : 'Qué dicen las fuentes de ' + esc(countryName(code)) + ', comparado con Argentina.') + '</p>';
    if (!rows.length) return html + '<p class="muted">Todavía no hay datos de este país.</p>';
    html += '<div class="list">' + rows.map(({ t, hoy, ar }) => {
      const fut = HORIZONS.map(h => ({ h, s: bestStatus(t.id, code, h.key) })).filter(x => x.s);
      const cmp = code !== HOME && hoy && hoy.level && ar && ar.level
        ? '<span class="small muted">Argentina: ' + LEVEL_LABEL[ar.level].toLowerCase() + '</span>' : '';
      return '<button type="button" class="row" data-open-trend="' + t.id + '"><span>' + meter(hoy && hoy.level) + '</span>' +
        '<span class="row-main"><strong>' + esc(t.name) + '</strong>' +
        (hoy ? '<span class="muted small">' + esc(hoy.rationale) + '</span>' : '') +
        fut.map(x => '<span class="fut"><b>' + x.h.title + ':</b> ' + esc(x.s.rationale) + '</span>').join('') + '</span>' +
        '<span class="row-side"><span class="level">' + (hoy && hoy.level ? LEVEL_LABEL[hoy.level] : (hoy ? 'Sin clasificar' : 'Sin dato de hoy')) + '</span>' + cmp + '</span></button>';
    }).join('') + '</div>';
    return html;
  }

  function showDrawer() {
    const top = state.stack[state.stack.length - 1];
    $('#drawer-body').innerHTML = top.type === 'trend' ? trendDrawer(top.id) : countryDrawer(top.id);
    $('#drawer-body').scrollTop = 0;
    $('#drawer-back').hidden = state.stack.length < 2;
    state.selected = top.type === 'country' ? top.id : null;
    drawMap(); renderCountryChips();
  }

  function openDrawer(entry) {
    const dr = $('#drawer'), sc = $('#scrim');
    if (dr.hidden) state.lastFocus = document.activeElement;
    state.stack.push(entry);
    dr.hidden = false; sc.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { dr.classList.add('open'); sc.classList.add('open'); });
    showDrawer();
    setTimeout(() => $('#drawer-close').focus(), 50);
  }

  function closeDrawer() {
    const dr = $('#drawer'), sc = $('#scrim');
    dr.classList.remove('open'); sc.classList.remove('open');
    state.stack = []; state.selected = null;
    document.body.style.overflow = '';
    setTimeout(() => { dr.hidden = true; sc.hidden = true; }, 260);
    drawMap(); renderCountryChips();
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  // ------------------------------------------------------------ eventos
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-cat],[data-mapview],[data-open-trend],[data-open-country],[data-country]');
    if (e.target.id === 'scrim') return closeDrawer();
    if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderPanel(); }
    else if (t.dataset.cat) { state.cat = t.dataset.cat; renderPanel(); }
    else if (t.dataset.mapview) { state.mapView = t.dataset.mapview; renderHero(); }
    else if (t.dataset.openTrend) openDrawer({ type: 'trend', id: t.dataset.openTrend });
    else if (t.dataset.openCountry || t.dataset.country) openDrawer({ type: 'country', id: t.dataset.openCountry || t.dataset.country });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#drawer').hidden) return closeDrawer();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('path[data-country]')) {
      e.preventDefault(); openDrawer({ type: 'country', id: e.target.dataset.country });
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.closest && e.target.closest('.tabs')) {
      const tabs = [...document.querySelectorAll('.tabs button')];
      const i = tabs.indexOf(document.activeElement);
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus(); next.click();
    }
  });
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-back').addEventListener('click', () => { state.stack.pop(); showDrawer(); });

  // ------------------------------------------------------------ arranque
  async function start() {
    const demo = new URLSearchParams(location.search).has('demo');
    try {
      state.data = demo ? window.DEMO_DATA : await loadFromSupabase();
      renderAll();
    } catch (err) {
      console.error(err);
      $('#hero').innerHTML = '<div><h1>No pudimos cargar los datos.</h1>' +
        '<p class="lead">Revisá la conexión y probá de nuevo. Si sigue igual, avisale a quien mantiene el agente.</p>' +
        '<p class="howto small">Detalle técnico: ' + esc(err.message) + '</p>' +
        '<a class="btn" href="">Reintentar</a> <a class="btn ghost" href="?demo=1">Ver datos de ejemplo</a></div>';
      $('#panel').innerHTML = '';
    }
  }
  start();
})();
