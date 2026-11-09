// DATOS DE EJEMPLO. No son reales: sirven para ver cómo se ve el dashboard (abrir con ?demo=1).
// Los textos y las "citas" están inventados a propósito y marcados como ejemplo.
window.DEMO_DATA = (function () {
  const T = (id, slug, name, summary, category) => ({ id, slug, name, summary, category });
  const trends = [
    T('t1', 'trazabilidad-electronica', 'Trazabilidad electrónica individual', 'Identificar a cada animal con caravana o bolo electrónico para conocer su origen e historia sanitaria.', 'tecnologia'),
    T('t2', 'ganaderia-de-precision', 'Ganadería de precisión', 'Sensores, collares, balanzas y drones que miden al rodeo sin tener que encerrarlo.', 'tecnologia'),
    T('t3', 'genetica-mejoramiento', 'Genética y mejoramiento', 'Elegir toros y vientres con datos (DEP, genómica) para mejorar kilos, fertilidad y eficiencia.', 'tecnologia'),
    T('t4', 'manejo-pasturas', 'Manejo de pasturas y pastoreo planificado', 'Usar imágenes satelitales y pastoreo rotativo para cuidar el pasto y producir más carne por hectárea.', 'tecnologia'),
    T('t5', 'intensificacion-feedlot', 'Intensificación y eficiencia de conversión', 'Terminar los animales con corral y suplementación para ganar kilos más rápido y con menos alimento.', 'tecnologia'),
    T('t6', 'exigencias-exportacion', 'Exigencias de sostenibilidad y trazabilidad para exportar', 'Reglas de la Unión Europea, China y otros destinos que piden probar de dónde viene la carne.', 'regulacion'),
    T('t7', 'financiamiento-ganadero', 'Crédito y financiamiento para invertir', 'Líneas de crédito y herramientas financieras para que el productor pueda adoptar tecnología.', 'financiamiento'),
    T('t8', 'carne-diferenciada', 'Carne certificada y con valor agregado', 'Programas, marcas y certificaciones que permiten cobrar más por una carne con atributos reconocidos.', 'mercado'),
    T('t9', 'reduccion-emisiones', 'Huella de carbono y reducción de emisiones', 'Medir y bajar las emisiones de la producción, algo que cada vez piden más los compradores.', 'mercado'),
    T('t10', 'gestion-digital', 'Software de gestión del rodeo', 'Registrar stock, sanidad, pesadas y costos en el celular en lugar de en cuadernos.', 'tecnologia'),
  ];

  let n = 0;
  const S = (trendId, country, horizon, level, confidence, rationale, pct = null, note = null) =>
    ({ id: 's' + ++n, trendId, country, horizon, level, pct, note, confidence, rationale });

  const statuses = [
    S('t1', 'AR', 'hoy', 'en_expansion', 0.85, '(Ejemplo) La identificación electrónica pasó a ser obligatoria y se está implementando de a poco.', 35, 'del rodeo con caravana electrónica (ejemplo)'),
    S('t1', 'UY', 'hoy', 'generalizada', 0.9, '(Ejemplo) Uruguay tiene identificación individual obligatoria hace años.', 90, 'del rodeo identificado (ejemplo)'),
    S('t1', 'AU', 'hoy', 'generalizada', 0.8, '(Ejemplo) Australia usa un sistema nacional de identificación electrónica.'),
    S('t1', 'AR', 'corto', null, 0.7, '(Ejemplo) Se espera que más productores se sumen y que aparezcan lectores más baratos.'),

    S('t2', 'AR', 'hoy', 'incipiente', 0.7, '(Ejemplo) Hay pruebas con collares y balanzas inteligentes en pocos establecimientos.'),
    S('t2', 'AU', 'hoy', 'en_expansion', 0.75, '(Ejemplo) En Australia crece el uso de sensores y balanzas automáticas.'),
    S('t2', 'AR', 'mediano', null, 0.6, '(Ejemplo) Se espera que baje el costo de los sensores y se use más en feedlots.'),
    S('t2', 'US', 'mediano', null, 0.55, '(Ejemplo) En EE.UU. esperan que la visión por computadora monitoree el rodeo.'),

    S('t3', 'AR', 'hoy', 'en_expansion', 0.8, '(Ejemplo) El uso de datos genéticos para elegir toros crece en cabañas y criadores grandes.'),
    S('t3', 'US', 'hoy', 'generalizada', 0.7, '(Ejemplo) En EE.UU. la selección con datos genómicos es lo habitual.'),
    S('t3', 'AR', 'largo', null, 0.5, '(Ejemplo) Se anticipa genómica de bajo costo para el productor chico.'),

    S('t4', 'AR', 'hoy', 'incipiente', 0.65, '(Ejemplo) Algunos productores miden el pasto con imágenes satelitales.'),
    S('t4', 'UY', 'hoy', 'en_expansion', 0.6, '(Ejemplo) En Uruguay se difunde el pastoreo planificado con apoyo técnico.'),
    S('t4', 'AR', 'corto', null, 0.6, '(Ejemplo) Se espera más oferta de servicios de monitoreo de pasturas.'),

    S('t5', 'AR', 'hoy', 'en_expansion', 0.8, '(Ejemplo) El engorde a corral sigue creciendo y ya terminan una parte relevante de los animales.'),
    S('t5', 'BR', 'hoy', 'en_expansion', 0.75, '(Ejemplo) Brasil también expande el confinamiento.'),

    S('t6', 'AR', 'hoy', 'incipiente', 0.7, '(Ejemplo) Pocos frigoríficos y productores están preparados para demostrar el origen sin deforestación.'),
    S('t6', 'EU', 'hoy', 'generalizada', 0.85, '(Ejemplo) La Unión Europea ya exige pruebas de origen para varios productos, la carne entre ellos.'),
    S('t6', 'AR', 'corto', null, 0.65, '(Ejemplo) Se espera que la exigencia llegue a más mercados y obligue a mostrar el origen.'),
    S('t6', 'AR', 'mediano', null, 0.55, '(Ejemplo) Se espera que la huella de carbono se sume a lo que piden los compradores.'),

    S('t7', 'AR', 'hoy', 'incipiente', 0.55, '(Ejemplo) Hay líneas de crédito para tecnología ganadera, pero con poco uso.'),
    S('t7', 'AR', 'corto', null, 0.5, '(Ejemplo) Se anticipan nuevas líneas atadas a la trazabilidad.'),

    S('t8', 'AR', 'hoy', 'generalizada', 0.8, '(Ejemplo) Los programas de carne certificada están muy difundidos en las exportaciones.'),
    S('t8', 'UY', 'hoy', 'en_expansion', 0.7, '(Ejemplo) Uruguay promociona su carne natural en mercados premium.'),

    S('t9', 'AU', 'hoy', 'incipiente', 0.6, '(Ejemplo) Australia empieza a medir y reportar emisiones por establecimiento.'),
    S('t9', 'AR', 'largo', null, 0.45, '(Ejemplo) Se espera que medir emisiones sea una exigencia para exportar.'),
  ];
  const sid = (t, c, h) => (statuses.find(s => s.trendId === t && s.country === c && s.horizon === h) || {}).id;

  const gap = (id, trendId, cl, rl, refCountry, conf, rationale, cp = null, rp = null) => ({
    id, trendId, currentLevel: cl, referenceLevel: rl, refCountry, confidence: conf, rationale, currentPct: cp, refPct: rp,
    gapLevels: ['sin_adopcion', 'incipiente', 'en_expansion', 'generalizada'].indexOf(rl) - ['sin_adopcion', 'incipiente', 'en_expansion', 'generalizada'].indexOf(cl),
  });
  const gaps = [
    gap('g1', 't1', 'en_expansion', 'generalizada', 'UY', 0.85, '(Ejemplo) Argentina recién implementa lo que Uruguay hace hace años.', 35, 90),
    gap('g2', 't2', 'incipiente', 'en_expansion', 'AU', 0.7, '(Ejemplo) Australia ya usa sensores y balanzas automáticas a mayor escala.'),
    gap('g3', 't3', 'en_expansion', 'generalizada', 'US', 0.7, '(Ejemplo) En EE.UU. la selección genética con datos es lo normal.'),
    gap('g4', 't6', 'incipiente', 'generalizada', 'EU', 0.7, '(Ejemplo) La Unión Europea ya exige lo que acá apenas empieza a prepararse.'),
    gap('g5', 't4', 'incipiente', 'en_expansion', 'UY', 0.6, '(Ejemplo) Uruguay difunde más el pastoreo planificado.'),
    gap('g6', 't5', 'en_expansion', 'en_expansion', 'BR', 0.75, '(Ejemplo) Argentina y Brasil van parejos en engorde a corral.'),
    gap('g7', 't8', 'generalizada', 'en_expansion', 'UY', 0.7, '(Ejemplo) Argentina tiene más difundidos los programas de carne certificada.'),
  ];

  const E = (trendId, statusKey, gapId, quote, supports, source, title, date, url) =>
    ({ trendId, statusId: statusKey ? sid(...statusKey) : null, gapId, quote, supports, source, title, date, url });
  const ex = 'https://example.com/ejemplo';
  const evidence = [
    E('t1', ['t1', 'AR', 'hoy'], null, '(Cita de ejemplo) La identificación electrónica de los bovinos pasó a ser obligatoria y se aplica de forma gradual.', 'adopcion', 'Medio de ejemplo', 'Nota de ejemplo sobre trazabilidad', '2026-10-02', ex + '/1'),
    E('t1', ['t1', 'UY', 'hoy'], null, '(Cita de ejemplo) La identificación individual del ganado es obligatoria en Uruguay desde hace años.', 'adopcion', 'Instituto de ejemplo', 'Informe de ejemplo', '2026-08-14', ex + '/2'),
    E('t1', null, 'g1', '(Cita de ejemplo) En Uruguay la mayoría del rodeo está identificado de forma individual.', 'referencia', 'Instituto de ejemplo', 'Informe de ejemplo', '2026-08-14', ex + '/2'),
    E('t2', ['t2', 'AR', 'hoy'], null, '(Cita de ejemplo) Algunos establecimientos están probando collares con sensores para detectar celo y enfermedades.', 'adopcion', 'Medio de ejemplo', 'Tecnología en el campo (ejemplo)', '2026-09-20', ex + '/3'),
    E('t2', ['t2', 'AU', 'hoy'], null, '(Cita de ejemplo) Las balanzas automáticas ya se usan en una parte creciente de los establecimientos.', 'adopcion', 'Gremio de ejemplo', 'Informe de adopción (ejemplo)', '2026-07-30', ex + '/4'),
    E('t3', ['t3', 'AR', 'hoy'], null, '(Cita de ejemplo) El uso de datos genéticos para elegir reproductores crece entre los criadores.', 'adopcion', 'Medio de ejemplo', 'Genética hoy (ejemplo)', '2026-10-11', ex + '/5'),
    E('t6', ['t6', 'EU', 'hoy'], null, '(Cita de ejemplo) El reglamento exige demostrar que los productos no provienen de tierras deforestadas.', 'adopcion', 'Fuente oficial de ejemplo', 'Reglamento (ejemplo)', '2026-06-05', ex + '/6'),
    E('t6', ['t6', 'AR', 'corto'], null, '(Cita de ejemplo) Los frigoríficos se preparan para cumplir con los nuevos requisitos de origen.', 'horizonte', 'Medio de ejemplo', 'Exportar con origen (ejemplo)', '2026-09-02', ex + '/7'),
    E('t5', ['t5', 'AR', 'hoy'], null, '(Cita de ejemplo) La cantidad de animales en corrales de engorde aumentó respecto del año pasado.', 'adopcion', 'Medio de ejemplo', 'Feedlots en aumento (ejemplo)', '2026-10-28', ex + '/8'),
  ];

  return {
    meta: { demo: true, updatedAt: '2026-11-08T12:00:00Z', docs: 58 },
    trends, statuses, gaps, evidence,
  };
})();
