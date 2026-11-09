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
  const CAT_ORDER = ['tecnologia', 'mercado', 'regulacion', 'financiamiento'];
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

  // Códigos ISO numéricos (los usa el globo). EU = Unión Europea (todos sus miembros).
  const ISO_NUM = {
    AR: 32, UY: 858, BR: 76, AU: 36, US: 840, PY: 600, CL: 152, BO: 68, PE: 604, CO: 170, EC: 218, VE: 862, GY: 328,
    MX: 484, CA: 124, CN: 156, NZ: 554, ZA: 710, IN: 356, JP: 392, KR: 410, GB: 826, RU: 643, VN: 704, ID: 360,
    TH: 764, SA: 682, AE: 784, EG: 818, TR: 792, UA: 804, KZ: 398, NG: 566, KE: 404, ET: 231, IL: 376, CH: 756, NO: 578,
  };
  const EU_NUM = [40, 56, 100, 191, 196, 203, 208, 233, 246, 250, 276, 300, 348, 372, 380, 428, 440, 442, 470, 528, 616, 620, 642, 703, 705, 724, 752];
  const NUM_TO_CODE = new Map();
  Object.entries(ISO_NUM).forEach(([c, n]) => NUM_TO_CODE.set(n, c));
  EU_NUM.forEach(n => NUM_TO_CODE.set(n, 'EU'));

  const state = { data: null, tab: 'hoy', cat: 'todas', view: 'ar', stack: [], lastFocus: null };

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
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

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
      const key = e.trend_id + '|' + e.quote + '|' + e.supports;
      if (seen.has(key)) return;
      seen.add(key);
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
  const countriesOfTrend = id => [...new Set(D().statuses.filter(s => s.trendId === id).map(s => s.country))];

  function gapTag(g) {
    if (g.gapLevels >= 2) return { cls: 'late-2', text: g.gapLevels + ' niveles de atraso' };
    if (g.gapLevels === 1) return { cls: 'late-1', text: 'Un nivel de atraso' };
    if (g.gapLevels === 0) return { cls: 'ok', text: 'Al día' };
    return { cls: 'ok', text: 'Argentina va adelante' };
  }
  const gapColor = cls => cssVar(cls === 'late-2' ? '--hereford' : cls === 'late-1' ? '--trigo' : '--campo');

  // ------------------------------------------------------------ portada
  function heroSentence() {
    const d = D();
    if (!d.statuses.length) {
      return { h: 'Todavía no hay datos cargados.', p: 'Cuando el agente termine su primera corrida, acá vas a ver cómo está la ganadería argentina frente al resto.' };
    }
    if (!d.gaps.length) {
      return {
        h: 'Todavía no hay datos suficientes para comparar a Argentina con otros países.',
        p: 'Ya hay ' + new Set(d.statuses.map(s => s.trendId)).size + ' tendencias con información. Falta que las fuentes digan en qué nivel está cada país.',
      };
    }
    const late = d.gaps.filter(g => g.gapLevels > 0).sort((a, b) => b.gapLevels - a.gapLevels || b.confidence - a.confidence);
    const h = 'Argentina está atrasada en ' + late.length + ' de ' + d.gaps.length + ' ' +
      plural(d.gaps.length, 'tendencia comparable', 'tendencias que se pueden comparar') + ' con otros países.';
    const p = late.length
      ? 'El mayor atraso: ' + (trendById(late[0].trendId) || {}).name + ', frente a ' + countryName(late[0].refCountry) + '.'
      : 'En el resto va al día o adelante.';
    return { h, p };
  }

  function glanceHtml() {
    const g = D().gaps;
    if (!g.length) return '';
    const n2 = g.filter(x => x.gapLevels >= 2).length;
    const n1 = g.filter(x => x.gapLevels === 1).length;
    const n0 = g.filter(x => x.gapLevels <= 0).length;
    const parts = [
      { cls: 'late-2', n: n2, txt: plural(n2, 'tendencia con 2 niveles o más de atraso', 'tendencias con 2 niveles o más de atraso') },
      { cls: 'late-1', n: n1, txt: plural(n1, 'tendencia con un nivel de atraso', 'tendencias con un nivel de atraso') },
      { cls: 'ok', n: n0, txt: plural(n0, 'tendencia al día o con Argentina adelante', 'tendencias al día o con Argentina adelante') },
    ].filter(p => p.n > 0);
    const aria = parts.map(p => p.n + ' ' + p.txt).join(', ');
    return '<div class="glance"><h2>De un vistazo</h2>' +
      '<div class="glance-bar" role="img" aria-label="' + esc(aria) + '">' +
      parts.map(p => '<span class="' + p.cls + '" style="flex:' + p.n + '"></span>').join('') + '</div>' +
      '<ul class="glance-legend">' + parts.map(p => '<li class="' + p.cls + '"><i></i><span><b>' + p.n + '</b> ' + p.txt + '</span></li>').join('') + '</ul></div>';
  }

  function renderHero() {
    const d = D();
    const { h, p } = heroSentence();
    const countries = countriesWithData();
    const nTrends = new Set(d.statuses.map(s => s.trendId)).size;
    const facts = [
      '<li><strong>' + nTrends + '</strong> ' + plural(nTrends, 'tendencia seguida', 'tendencias seguidas') + '</li>',
      '<li><strong>' + countries.length + '</strong> ' + plural(countries.length, 'país con información', 'países con información') + '</li>',
      d.meta.docs ? '<li><strong>' + d.meta.docs + '</strong> notas e informes leídos</li>' : '',
      d.evidence.length ? '<li><strong>' + d.evidence.length + '</strong> citas para verificar</li>' : '',
    ].join('');
    const view = k => 'aria-pressed="' + (state.view === k) + '"';
    $('#hero').innerHTML = '<div><h1>' + esc(h) + '</h1><p class="lead">' + esc(p) + '</p>' + glanceHtml() +
      '<ul class="facts">' + facts + '</ul></div>';
    $('#globecol').innerHTML =
      '<div class="globebox"><div class="globebar"><h2>Países con información</h2>' +
      '<div class="seg" role="group" aria-label="Qué parte del mundo ver">' +
      '<button type="button" data-globe="ar" ' + view('ar') + '>Argentina</button>' +
      '<button type="button" data-globe="sa" ' + view('sa') + '>Sudamérica</button>' +
      '<button type="button" data-globe="world" ' + view('world') + '>Mundo</button></div></div>' +
      '<div class="globewrap"><canvas id="globe" tabindex="0" role="img" ' +
      'aria-label="Globo terráqueo. Arrastrá para girarlo. Los países con información se pueden abrir con los botones de abajo."></canvas>' +
      '<div class="gtip" id="gtip" hidden></div>' +
      '<div class="zoomctl"><button type="button" data-zoom="in" aria-label="Acercar">+</button><button type="button" data-zoom="out" aria-label="Alejar">−</button></div></div>' +
      '<p class="globehint">Arrastrá para girar y tocá un país verde para ver su detalle.</p>' +
      '<div class="chips" id="country-chips"></div></div>';
    initGlobe();
    renderCountryChips();
  }

  function initGlobe() {
    const canvas = $('#globe');
    if (!canvas || !window.Globe) return;
    const ok = Globe.init(canvas, {
      codeOf: n => NUM_TO_CODE.get(n),
      onSelect: code => openDrawer({ type: 'country', id: code }),
      onHover: (code, x, y) => {
        const tip = $('#gtip');
        if (!code) { tip.hidden = true; return; }
        const n = new Set(D().statuses.filter(s => s.country === code).map(s => s.trendId)).size;
        tip.textContent = countryName(code) + ': ' + n + ' ' + plural(n, 'tendencia', 'tendencias');
        tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.hidden = false;
      },
    });
    if (!ok) return;
    Globe.setActive(countriesWithData());
  }

  function renderCountryChips() {
    const el = $('#country-chips');
    if (!el) return;
    const counts = {};
    D().statuses.forEach(s => { (counts[s.country] = counts[s.country] || new Set()).add(s.trendId); });
    const top = state.stack[state.stack.length - 1];
    const sel = top && top.type === 'country' ? top.id : null;
    const codes = Object.keys(counts).sort((a, b) => (a === HOME ? -1 : b === HOME ? 1 : countryName(a).localeCompare(countryName(b), 'es')));
    el.innerHTML = codes.map(c =>
      '<button type="button" class="chip" data-open-country="' + c + '" aria-pressed="' + (sel === c) + '">' +
      esc(countryName(c)) + ' <small>' + counts[c].size + '</small></button>').join('');
  }

  // ------------------------------------------------------------ secciones
  function legendHtml() {
    return '<details class="legend"><summary>¿Qué significa cada nivel?</summary><ul>' +
      LEVELS.map(l => '<li>' + meter(l) + '<span><b>' + LEVEL_LABEL[l] + '</b>' + LEVEL_HELP[l] + '</span></li>').join('') + '</ul></details>';
  }

  function toolbarHtml() {
    const cats = ['todas'].concat(CAT_ORDER);
    return '<div class="toolbar" role="group" aria-label="Filtrar por tema"><span class="label">Tema:</span>' +
      cats.map(c => '<button type="button" class="chip" data-cat="' + c + '" aria-pressed="' + (state.cat === c) + '">' +
        (c === 'todas' ? 'Todos' : CATEGORY_LABEL[c]) + '</button>').join('') + '</div>';
  }

  function sheetHead(title, sub) {
    return '<div class="sheet-head"><div><h2>' + title + '</h2><p class="sub">' + sub + '</p></div></div>';
  }

  function viewHoy() {
    const rows = D().trends.filter(inCat).map(t => ({ t, s: bestStatus(t.id, HOME, 'hoy') }));
    const withData = rows.filter(r => r.s);
    const without = rows.filter(r => !r.s);
    let html = sheetHead('Qué está pasando hoy en Argentina', 'Qué tan extendida está cada tendencia, según lo que dicen las fuentes. Tocá una para ver las citas.') +
      toolbarHtml() + legendHtml();
    if (!withData.length) {
      html += '<div class="notice"><h3>Todavía no hay datos de Argentina en este tema</h3><p>Probá con otro tema o esperá la próxima actualización del agente.</p></div>';
    } else {
      html += '<div class="thead" aria-hidden="true"><span></span><span>Tendencia</span><span>Nivel de adopción</span><span>Confianza</span></div>';
      (state.cat === 'todas' ? CAT_ORDER : [state.cat]).forEach(cat => {
        const items = withData.filter(r => r.t.category === cat)
          .sort((a, b) => rank(b.s.level) - rank(a.s.level) || a.t.name.localeCompare(b.t.name, 'es'));
        if (!items.length) return;
        html += '<h3 class="grp">' + (CATEGORY_LABEL[cat] || cat) + '<span>' + items.length + '</span></h3>' +
          items.map(({ t, s }) =>
            '<button type="button" class="row" data-open-trend="' + t.id + '">' +
            '<span>' + meter(s.level) + '</span>' +
            '<span class="row-main"><strong>' + esc(t.name) + '</strong><span class="muted">' + esc(t.summary) + '</span></span>' +
            '<span class="c-level level">' + (s.level ? LEVEL_LABEL[s.level] : 'Sin clasificar') + '</span>' +
            '<span class="c-conf"><span class="pill ' + confLabel(s.confidence) + '">' + confLabel(s.confidence).replace(/^./, c => c.toUpperCase()) + '</span></span></button>').join('');
      });
    }
    if (without.length) {
      html += '<details class="nodata"><summary>Tendencias que seguimos y todavía no tienen datos de Argentina (' + without.length + ')</summary><ul>' +
        without.map(r => '<li>' + esc(r.t.name) + '</li>').join('') + '</ul></details>';
    }
    return html;
  }

  function viewViene() {
    let html = sheetHead('Qué puede venir', 'Lo que las fuentes anticipan para los próximos años. Tocá una tendencia para ver quién lo dice y dónde.') + toolbarHtml();
    html += '<div class="horizons">' + HORIZONS.map(h => {
      const byTrend = new Map();
      D().statuses.filter(s => s.horizon === h.key).forEach(s => {
        const t = trendById(s.trendId);
        if (!t || !inCat(t)) return;
        if (!byTrend.has(t.id)) byTrend.set(t.id, []);
        byTrend.get(t.id).push(s);
      });
      const items = [...byTrend.entries()].map(([id, list]) => {
        list.sort((a, b) => b.confidence - a.confidence);
        return { t: trendById(id), list };
      }).sort((a, b) => b.list[0].confidence - a.list[0].confidence);
      return '<div class="horizon"><header><h3>' + h.title + '</h3><span class="muted small">' + h.range + ' (' + items.length + ')</span></header>' +
        (items.length ? '<div class="hitems">' + items.map(({ t, list }) =>
          '<button type="button" class="future" data-open-trend="' + t.id + '"><strong>' + esc(t.name) + '</strong>' +
          '<span class="pills">' + [...new Set(list.map(s => s.country))].map(c => '<span class="pill pais">' + esc(countryName(c)) + '</span>').join('') + '</span>' +
          '<span class="why">' + esc(list[0].rationale) + '</span></button>').join('') + '</div>'
          : '<p class="empty-col">Sin novedades en este plazo.</p>') + '</div>';
    }).join('') + '</div>';
    return html;
  }

  function viewBrechas() {
    const gaps = D().gaps.filter(g => inCat(trendById(g.trendId)))
      .sort((a, b) => b.gapLevels - a.gapLevels || b.confidence - a.confidence);
    let html = sheetHead('Dónde estamos atrasados', 'Ubicamos a Argentina y al país más avanzado en una escala de cuatro niveles. Cuanto más lejos están los puntos, mayor la brecha.') +
      toolbarHtml() + legendHtml();
    if (!gaps.length) {
      return html + '<div class="notice"><h3>Todavía no hay brechas para mostrar</h3>' +
        '<p>Para comparar hace falta que las fuentes den el nivel de una tendencia en Argentina y en al menos otro país. A medida que el agente lea más notas, esta sección se completa.</p>' +
        (D().meta.demo ? '' : '<a class="btn ghost" href="?demo=1">Ver cómo se vería con datos de ejemplo</a>') + '</div>';
    }
    html += '<div class="gaplist"><div class="gscale" aria-hidden="true">' +
      LEVELS.map(l => '<span>' + LEVEL_LABEL[l] + '</span>').join('') + '</div>';
    html += gaps.map(g => {
      const t = trendById(g.trendId) || { name: '?', summary: '' };
      const tag = gapTag(g);
      const a = rank(g.currentLevel), r = rank(g.referenceLevel);
      const pos = i => i * 25 + 12.5;
      const same = a === r;
      const arLeft = same ? 'calc(' + pos(a) + '% - 19px)' : pos(a) + '%';
      const refLeft = same ? 'calc(' + pos(r) + '% + 19px)' : pos(r) + '%';
      const barL = Math.min(pos(a), pos(r)), barW = Math.abs(pos(a) - pos(r));
      return '<button type="button" class="grow ' + tag.cls + '" data-open-trend="' + g.trendId + '" data-ref="' + esc(g.refCountry) + '" data-status="' + tag.cls + '">' +
        '<span class="g-name"><strong>' + esc(t.name) + '</strong><span class="muted">' + esc(t.summary) + '</span></span>' +
        '<span class="g-tag"><span class="tag ' + tag.cls + '">' + tag.text + '</span>' +
        '<small>frente a ' + esc(countryName(g.refCountry)) + '</small></span>' +
        '<span class="g-track" aria-hidden="true"><span class="col"></span><span class="col"></span><span class="col"></span><span class="col"></span>' +
        (barW ? '<span class="g-bar" style="left:' + barL + '%;width:' + barW + '%"></span>' : '') +
        '<span class="g-dot ar" style="left:' + arLeft + '">AR</span>' +
        '<span class="g-dot ref" style="left:' + refLeft + '">' + esc(g.refCountry) + '</span></span>' +
        '<span class="sr">Argentina: ' + LEVEL_LABEL[g.currentLevel].toLowerCase() + '. ' + esc(countryName(g.refCountry)) + ': ' + LEVEL_LABEL[g.referenceLevel].toLowerCase() + '.</span></button>';
    }).join('') + '</div>';
    return html;
  }

  function renderPanel() {
    const view = state.tab === 'hoy' ? viewHoy() : state.tab === 'viene' ? viewViene() : viewBrechas();
    $('#panel').innerHTML = '<div class="sheet">' + view + '</div>';
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
    const countries = countriesOfTrend(id).sort((a, b) => (a === HOME ? -1 : b === HOME ? 1 : countryName(a).localeCompare(countryName(b), 'es')));
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
    html += '<h3>De dónde sale</h3>' + evidenceHtml(d.evidence.filter(e => e.trendId === id));
    return html;
  }

  function countryDrawer(code) {
    const d = D();
    const ids = [...new Set(d.statuses.filter(s => s.country === code).map(s => s.trendId))];
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

  // El globo acompaña lo que se está mirando.
  function syncGlobe() {
    if (!window.Globe || !Globe._inited) return;
    const top = state.stack[state.stack.length - 1];
    if (!top) { Globe.setSelected(null); Globe.setHighlight([]); Globe.setArc(null); return; }
    if (top.type === 'country') {
      Globe.setSelected(top.id); Globe.setHighlight([]); Globe.setArc(null);
      if (Globe.hasCountry(top.id)) Globe.focus(top.id, top.id === HOME ? 1.5 : 1.25);
    } else {
      Globe.setSelected(null);
      Globe.setHighlight(countriesOfTrend(top.id));
      const gap = D().gaps.find(g => g.trendId === top.id);
      if (gap && Globe.hasCountry(gap.refCountry) && Globe.hasCountry(HOME)) {
        Globe.setArc(HOME, gap.refCountry, gapColor(gapTag(gap).cls));
        Globe.focus(Globe.midpoint(HOME, gap.refCountry), 1.05);
      } else Globe.setArc(null);
    }
  }

  function showDrawer() {
    const top = state.stack[state.stack.length - 1];
    $('#drawer-body').innerHTML = top.type === 'trend' ? trendDrawer(top.id) : countryDrawer(top.id);
    $('#drawer-body').scrollTop = 0;
    $('#drawer-back').hidden = state.stack.length < 2;
    renderCountryChips();
    syncGlobe();
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
    state.stack = [];
    document.body.style.overflow = '';
    setTimeout(() => { dr.hidden = true; sc.hidden = true; }, 260);
    renderCountryChips(); syncGlobe();
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  // ------------------------------------------------------------ eventos
  function globeView(k) {
    state.view = k;
    document.querySelectorAll('[data-globe]').forEach(b => b.setAttribute('aria-pressed', b.dataset.globe === k));
    if (!window.Globe || !Globe._inited) return;
    if (k === 'ar') Globe.focus(HOME, 1.5);
    else if (k === 'sa') Globe.focus([-60, -18], 1.3);
    else Globe.focus('world', 0.95);
  }

  document.addEventListener('click', e => {
    if (e.target.id === 'scrim') return closeDrawer();
    const t = e.target.closest('[data-tab],[data-cat],[data-globe],[data-zoom],[data-open-trend],[data-open-country]');
    if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderPanel(); }
    else if (t.dataset.cat) { state.cat = t.dataset.cat; renderPanel(); }
    else if (t.dataset.globe) globeView(t.dataset.globe);
    else if (t.dataset.zoom) { if (window.Globe && Globe._inited) Globe.zoom(t.dataset.zoom === 'in' ? 1.3 : 0.77); }
    else if (t.dataset.openTrend) openDrawer({ type: 'trend', id: t.dataset.openTrend });
    else if (t.dataset.openCountry) openDrawer({ type: 'country', id: t.dataset.openCountry });
  });

  // Al pasar el mouse (o enfocar) una tendencia, el globo muestra dónde pasa; en las brechas, traza el arco.
  let hoverTimer = null;
  function hoverOn(el) {
    if (!$('#drawer').hidden || !window.Globe || !Globe._inited) return;
    Globe.stopAuto();
    Globe.setHighlight(countriesOfTrend(el.dataset.openTrend));
    const ref = el.dataset.ref;
    clearTimeout(hoverTimer);
    if (ref && Globe.hasCountry(ref) && Globe.hasCountry(HOME)) {
      Globe.setArc(HOME, ref, gapColor(el.dataset.status));
      const mid = Globe.midpoint(HOME, ref);
      hoverTimer = setTimeout(() => Globe.focus(mid, 1.05, 800), 180);
    }
  }
  function hoverOff() {
    clearTimeout(hoverTimer);
    if (!$('#drawer').hidden || !window.Globe || !Globe._inited) return;
    Globe.setHighlight([]); Globe.setArc(null);
  }
  const hoverTarget = e => e.target.closest && e.target.closest('[data-open-trend]');
  document.addEventListener('mouseover', e => { const el = hoverTarget(e); if (el && !el.contains(e.relatedTarget)) hoverOn(el); });
  document.addEventListener('mouseout', e => { const el = hoverTarget(e); if (el && !el.contains(e.relatedTarget)) hoverOff(); });
  document.addEventListener('focusin', e => { const el = hoverTarget(e); if (el) hoverOn(el); });
  document.addEventListener('focusout', e => { if (hoverTarget(e)) hoverOff(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#drawer').hidden) return closeDrawer();
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
        '<p class="small muted" style="margin-top:1rem">Detalle técnico: ' + esc(err.message) + '</p>' +
        '<a class="btn" href="">Reintentar</a> <a class="btn ghost" href="?demo=1">Ver datos de ejemplo</a></div>';
      $('#panel').innerHTML = '';
    }
  }
  start();
})();
