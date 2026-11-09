/* Globo terráqueo interactivo. Dibuja con canvas 2D usando d3 (proyección ortográfica).
   - Arrastrar (mouse o dedo) para girar.
   - Gira solo hasta que la persona lo toca (no gira si el sistema pide menos movimiento).
   - Los países con información se pueden tocar; se pueden resaltar países y trazar un arco entre dos.
   Se usa desde app.js con window.Globe. */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const Globe = {
    _inited: false,

    init(canvas, opts) {
      if (!(window.d3 && window.topojson && window.WORLD_110M)) { canvas.hidden = true; return false; }
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts || {};
      this.rot = [64, 28];            // centrado en Argentina
      this.k = 1;
      this.active = new Set();
      this.highlight = new Set();
      this.selected = null;
      this.arc = null;
      this.hover = null;
      this.auto = !reduceMotion;
      this.visible = true;
      this.anim = null;
      this.dirty = true;
      this.looping = false;
      this.size = 0;

      const world = window.WORLD_110M;
      const all = topojson.feature(world, world.objects.countries).features.filter(f => Number(f.id) !== 10);
      this.features = all;
      this.borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
      this.byCode = new Map();
      all.forEach(f => {
        const code = (this.opts.codeOf || (() => null))(Number(f.id));
        if (code) { if (!this.byCode.has(code)) this.byCode.set(code, []); this.byCode.get(code).push(f); }
      });
      this.centroids = new Map();
      this.byCode.forEach((fs, code) => this.centroids.set(code, d3.geoCentroid({ type: 'FeatureCollection', features: fs })));

      this.proj = d3.geoOrthographic().clipAngle(90).precision(0.4);
      this.path = d3.geoPath(this.proj);
      this.graticule = d3.geoGraticule10();

      this._bind();
      this._observe();
      this.resize();
      this._inited = true;
      this.requestDraw();
      return true;
    },

    // ---------- datos que dibuja
    setActive(codes) { this.active = new Set(codes); this.requestDraw(); },
    setSelected(code) { this.selected = code || null; this.requestDraw(); },
    setHighlight(codes) { this.highlight = new Set(codes || []); this.requestDraw(); },
    setArc(a, b, color) {
      const ca = this.centroids.get(a), cb = this.centroids.get(b);
      this.arc = ca && cb ? { a: ca, b: cb, color: color || css('--trigo') } : null;
      this.requestDraw();
    },
    hasCountry(code) { return this.centroids.has(code); },
    midpoint(a, b) {
      const ca = this.centroids.get(a), cb = this.centroids.get(b);
      return ca && cb ? d3.geoInterpolate(ca, cb)(0.5) : null;
    },

    // ---------- movimiento
    stopAuto() { this.auto = false; },
    focus(target, k, ms) {
      let ll = null;
      if (Array.isArray(target)) ll = target;
      else if (target === 'world') { ll = [-30, 15]; k = k || 0.9; }
      else ll = this.centroids.get(target);
      if (!ll) return;
      this.stopAuto();
      const to = [-ll[0], Math.max(-75, Math.min(75, -ll[1]))];
      let dl = to[0] - this.rot[0];
      dl = ((dl + 540) % 360) - 180;               // camino más corto
      const from = this.rot.slice(), k0 = this.k, k1 = k || this.k;
      if (reduceMotion) { this.rot = [from[0] + dl, to[1]]; this.k = k1; this.requestDraw(); return; }
      this.anim = { t0: performance.now(), ms: ms || 900, from, dl, to1: to[1], k0, k1 };
      this._loop();
    },
    zoom(f) { this.focus(this.rot ? [-this.rot[0], -this.rot[1]] : [0, 0], Math.max(0.8, Math.min(3, this.k * f)), 350); },

    // ---------- tamaño
    resize() {
      const box = this.canvas.getBoundingClientRect();
      const s = Math.max(200, Math.round(box.width));
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      this.size = s; this.dpr = dpr;
      this.canvas.width = Math.round(s * dpr);
      this.canvas.height = Math.round(s * dpr);
      this.requestDraw();
    },

    // ---------- dibujo
    requestDraw() { this.dirty = true; this._loop(); },

    _loop() {
      if (this.looping) return;
      this.looping = true;
      const step = now => {
        let again = false;
        if (this.anim) {
          const a = this.anim, p = Math.min(1, (now - a.t0) / a.ms), e = d3.easeCubicInOut(p);
          this.rot = [a.from[0] + a.dl * e, a.from[1] + (a.to1 - a.from[1]) * e];
          this.k = a.k0 + (a.k1 - a.k0) * e;
          this.dirty = true;
          if (p >= 1) this.anim = null; else again = true;
        }
        if (this.auto && this.visible && !document.hidden) { this.rot[0] += 0.1; this.dirty = true; again = true; }
        if (this.dirty) { this.dirty = false; this._draw(); }
        if (again) requestAnimationFrame(step); else this.looping = false;
      };
      requestAnimationFrame(step);
    },

    _draw() {
      const { ctx, size: s, dpr } = this;
      const r = (s / 2) * 0.92 * this.k;
      this.proj.scale(r).translate([s / 2, s / 2]).rotate([this.rot[0], this.rot[1], 0]);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s, s);

      // halo suave alrededor del globo
      const g = ctx.createRadialGradient(s / 2, s / 2, r * 0.98, s / 2, s / 2, r * 1.1);
      g.addColorStop(0, 'rgba(76,140,90,0.28)'); g.addColorStop(1, 'rgba(76,140,90,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s / 2, s / 2, r * 1.1, 0, Math.PI * 2); ctx.fill();

      // océano
      const og = ctx.createRadialGradient(s / 2 - r * 0.3, s / 2 - r * 0.35, r * 0.1, s / 2, s / 2, r);
      og.addColorStop(0, '#c4dad2'); og.addColorStop(1, '#9dbfb4');
      ctx.beginPath(); this.path.context(ctx)({ type: 'Sphere' }); ctx.fillStyle = og; ctx.fill();

      // grilla
      ctx.beginPath(); this.path(this.graticule); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.5; ctx.stroke();

      // tierra
      ctx.beginPath(); this.features.forEach(f => this.path(f)); ctx.fillStyle = '#eef2ec'; ctx.fill();

      // países con información
      const hi = css('--trigo'), on = css('--pasto-2'), sel = css('--trigo');
      this.active.forEach(code => {
        const fs = this.byCode.get(code); if (!fs) return;
        const picked = code === this.selected;
        const lit = this.highlight.has(code);
        ctx.beginPath(); fs.forEach(f => this.path(f));
        ctx.fillStyle = picked ? sel : lit ? hi : (this.hover === code ? css('--pasto') : on);
        ctx.fill();
      });

      // fronteras
      ctx.beginPath(); this.path(this.borders); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.5; ctx.stroke();

      // arco entre dos países
      if (this.arc) {
        const line = { type: 'LineString', coordinates: [this.arc.a, this.arc.b] };
        ctx.beginPath(); this.path(line);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.stroke();
        ctx.beginPath(); this.path(line);
        ctx.strokeStyle = this.arc.color; ctx.lineWidth = 3; ctx.setLineDash([7, 6]); ctx.stroke(); ctx.setLineDash([]);
        const center = [-this.rot[0], -this.rot[1]];
        [this.arc.a, this.arc.b].forEach((pt, i) => {
          if (d3.geoDistance(center, pt) > Math.PI / 2) return;
          const xy = this.proj(pt);
          ctx.beginPath(); ctx.arc(xy[0], xy[1], i === 0 ? 7 : 6, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 ? css('--pasto') : this.arc.color; ctx.fill();
          ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        });
      }

      // borde del globo
      ctx.beginPath(); this.path({ type: 'Sphere' }); ctx.strokeStyle = 'rgba(29,58,43,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    },

    // ---------- interacción
    _xy(e) { const b = this.canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; },

    hit(x, y) {
      const ll = this.proj.invert([x, y]);
      if (!ll || isNaN(ll[0])) return null;
      for (const code of this.active) {
        const fs = this.byCode.get(code);
        if (fs && fs.some(f => d3.geoContains(f, ll))) return code;
      }
      return null;
    },

    _bind() {
      const c = this.canvas;
      let drag = null;
      const sens = () => 0.32 / this.k;
      c.addEventListener('pointerdown', e => {
        drag = { x: e.clientX, y: e.clientY, rot: this.rot.slice(), moved: false };
        this.anim = null; this.stopAuto();
        try { c.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
      });
      c.addEventListener('pointermove', e => {
        if (drag) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
          if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; c.classList.add('grabbing'); }
          if (drag.moved) {
            this.rot = [drag.rot[0] + dx * sens(), Math.max(-80, Math.min(80, drag.rot[1] - dy * sens()))];
            this.requestDraw();
          }
          return;
        }
        const [x, y] = this._xy(e);
        const code = this.hit(x, y);
        if (code !== this.hover) {
          this.hover = code;
          c.classList.toggle('over', !!code);
          this.requestDraw();
        }
        if (this.opts.onHover) this.opts.onHover(code, x, y);
      });
      const end = e => {
        if (!drag) return;
        const wasClick = !drag.moved;
        drag = null; c.classList.remove('grabbing');
        if (wasClick) {
          const [x, y] = this._xy(e);
          const code = this.hit(x, y);
          if (code && this.opts.onSelect) this.opts.onSelect(code);
        }
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', () => { drag = null; c.classList.remove('grabbing'); });
      c.addEventListener('pointerleave', () => {
        if (this.hover) { this.hover = null; c.classList.remove('over'); this.requestDraw(); if (this.opts.onHover) this.opts.onHover(null); }
      });
      // teclado: flechas giran, + y - acercan
      c.addEventListener('keydown', e => {
        const step = 8;
        const keys = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (keys[e.key]) {
          e.preventDefault(); this.stopAuto();
          this.rot = [this.rot[0] + keys[e.key][0], Math.max(-80, Math.min(80, this.rot[1] + keys[e.key][1]))];
          this.requestDraw();
        } else if (e.key === '+' || e.key === '=') { this.zoom(1.25); } else if (e.key === '-') { this.zoom(0.8); }
      });
    },

    _observe() {
      if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe(this.canvas);
      else window.addEventListener('resize', () => this.resize());
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(es => { this.visible = es[0].isIntersecting; if (this.visible) this.requestDraw(); }).observe(this.canvas);
      }
    },
  };

  window.Globe = Globe;
})();
