(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const nf = new Intl.NumberFormat('pt-BR');
const fmt = n => nf.format(n);
const pct = (x, d = 1) => (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const titulo = s => String(s || '').toLowerCase().replace(/(^|[\s\-\/(.])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Da|Do|Das|Dos|E|Em|Na|No)\b/g, w => w.toLowerCase());
const fmtCep = c => c && c.length === 8 ? c.slice(0, 5) + '-' + c.slice(5) : (c || '');

// Ambiente: dentro do Artifact (CSP fechada) não há mapa-base nem geocodificação externa.
const EXTERNO = !/[?&]offline/.test(location.search) && !window.claude && !/claude|anthropic/i.test(location.hostname) && /^https?:$/.test(location.protocol);

const CAND = {
  13: ['Lula', 'PT'], 22: ['Flávio Bolsonaro', 'PL'], 70: ['Augusto Cury', 'Avante'], 14: ['Renan Santos', 'Missão'],
  55: ['Ronaldo Caiado', 'PSD'], 30: ['Romeu Zema', 'Novo'], 80: ['Samara Martins', 'UP'], 16: ['Hertz Dias', 'PSTU'],
  27: ['Clariana Barão', 'DC'], 21: ['Edmilson Costa', 'PCB'], 35: ['Wilson Grassi', 'Democrata'], 29: ['Rui Costa Pimenta', 'PCO'],
  28: ['Leonardo Araújo', '—'], 95: ['Brancos', ''], 96: ['Nulos', '']
};
const nomeC = nr => (CAND[nr] || [String(nr)])[0];
const BINS_V = { 1: [0.45, 0.55, 0.65, 0.75], 2: [0.55, 0.6, 0.7, 0.8] };
const LBL_V = { 1: ['<45', '45', '55', '65', '75+'], 2: ['<55', '55', '60', '70', '80+'] };
const ALF_V = [0.26, 0.44, 0.62, 0.8, 0.97];
const ALF_C = [0.1, 0.26, 0.42, 0.6, 0.78, 0.96];

const ST = { turno: 2, modo: 'vencedor', cand: 13, uf: null, muni: null, cel: null, nivel: 'br' };
let BR, MAPA, CANDS, IDX, COR = {}, map, CEP = null;
const UFC = {};            // cache por UF
const GEO = {};            // resultado agregado por geometria municipal
const MUNI_FEAT = {};      // feição por código IBGE de geometria
const UF_FEAT = {};        // feição por código IBGE da UF
const UFCOD = {}, UFSIG = {};
let MUNI_LIST = [];        // para busca
const NAC = {};            // participação nacional por candidato e turno

// ---------- cores ----------
function lerCores() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['bg', 'land', 'ink', 'ink-2', 'muted', 'panel', 'rule', 'cell-line', 'muni-line', 'uf-line', 'c-13', 'c-22', 'c-55', 'c-70', 'c-outros', 'empate'])
    COR[k] = cs.getPropertyValue('--' + k).trim();
}
const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return '#' + A.map((v, i) => Math.round(v * t + B[i] * (1 - t)).toString(16).padStart(2, '0')).join(''); };
const corCand = nr => COR['c-' + nr] || COR['c-outros'];
const corModoCand = nr => COR['c-' + nr] || COR['c-70'];

// ---------- resultados ----------
function soma(a, b) { if (!b) return a; if (!a) return b.slice(); return a.map((x, i) => x + b[i]); }
function somaP(a, b) { if (!b) return a; if (!a) return b.slice(); return a.map((x, i) => x + b[i]); }
function resumo(v, p, t) {
  if (!v) return null;
  const n = v.length; let validos = 0, w = -1, wv = -1, seg = -1, tie = false;
  for (let i = 0; i < n - 2; i++) {
    validos += v[i];
    if (v[i] > wv) { seg = wv; wv = v[i]; w = i; tie = false; } else if (v[i] === wv) { tie = true; } else if (v[i] > seg) seg = v[i];
  }
  return { v, t, validos, brancos: v[n - 2], nulos: v[n - 1], w, tie: tie && wv > 0, wShare: validos ? wv / validos : 0, aptos: p ? p[0] : null, comp: p ? p[1] : null, secoes: p ? p[2] : null };
}
function corRes(r) {
  const t = ST.turno;
  if (!r || !r.validos) return COR.land;
  if (ST.modo === 'vencedor') {
    if (r.tie) return COR.empate;
    const nr = CANDS[t][r.w][0];
    let k = BINS_V[t].findIndex(b => r.wShare < b); if (k < 0) k = 4;
    return mix(corCand(nr), COR.land, ALF_V[k]);
  }
  const i = IDX[t][ST.cand]; if (i == null) return COR.land;
  const s = r.v[i] / r.validos, bins = binsCand(ST.cand);
  let k = bins.findIndex(b => s < b); if (k < 0) k = 5;
  return mix(corModoCand(ST.cand), COR.land, ALF_C[k]);
}
function binsCand(nr) { return (NAC[ST.turno][nr] || 0) > 0.15 ? [0.3, 0.4, 0.5, 0.6, 0.7] : [0.01, 0.02, 0.05, 0.1, 0.2]; }

// ---------- dados ----------
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }
const carregando = (on, txt) => { const el = $('#carregando'); if (txt) el.textContent = txt; el.hidden = !on; };

async function carregarUF(uf) {
  if (UFC[uf]) return UFC[uf];
  carregando(true, `Carregando locais de ${uf}…`);
  try {
    const [d, topo] = await Promise.all([getJSON(`data/dados_${uf}.json`), getJSON(`data/celulas_${uf}.json`)]);
    const fc = topojson.feature(topo, topo.objects.celulas);
    const cel = new Map();
    d.locais.forEach((l, i) => {
      if (l[7] < 0) return;
      let c = cel.get(l[7]); if (!c) { c = { ids: [], v1: null, v2: null, p1: null, p2: null }; cel.set(l[7], c); }
      c.ids.push(i); c.v1 = soma(c.v1, l[10]); c.p1 = somaP(c.p1, l[11]); c.v2 = soma(c.v2, l[12]); c.p2 = somaP(c.p2, l[13]);
    });
    const muniIdx = {}; d.munis.forEach((m, i) => { muniIdx[m.ibge] = i; m.locais = []; });
    d.locais.forEach((l, i) => d.munis[l[0]].locais.push(i));
    // bairros: centro ponderado pelos eleitores
    const bairros = new Map();
    d.locais.forEach(l => {
      if (!l[9] || !l[5] || l[8] !== 0) return;
      const k = l[0] + '|' + norm(l[5]); const w = (l[13] || l[11] || [1])[0] || 1;
      let b = bairros.get(k); if (!b) { b = { nome: l[5], m: l[0], x: 0, y: 0, w: 0, n: 0 }; bairros.set(k, b); }
      b.x += l[9][0] * w; b.y += l[9][1] * w; b.w += w; b.n++;
    });
    const bl = [...bairros.values()].map(b => ({ nome: b.nome, m: b.m, xy: [b.x / b.w, b.y / b.w], w: b.w, n: b.n })).sort((a, b) => b.w - a.w);
    const pontos = { type: 'FeatureCollection', features: d.locais.filter(l => l[9]).map(l => ({ type: 'Feature', properties: { f: l[8] }, geometry: { type: 'Point', coordinates: l[9] } })) };
    UFC[uf] = { uf, d, fc, cel, muniIdx, bairros: bl, pontos };
    return UFC[uf];
  } finally { carregando(false); }
}

async function ativarUF(uf) {
  const u = await carregarUF(uf);
  if (ST.uf !== uf) {
    ST.uf = uf;
    map.getSource('celulas').setData(u.fc);
    map.getSource('pontos').setData(u.pontos);
    map.setFilter('munis-fill', ['!=', ['get', 'uf'], UFCOD[uf]]);
    pintarCelulas();
  }
  return u;
}

// ---------- pintura ----------
function pintarMunis() {
  for (const g in GEO) map.setFeatureState({ source: 'munis', id: g }, { cor: corRes(resumo(GEO[g]['v' + ST.turno], null, ST.turno)) });
}
function pintarCelulas() {
  const u = UFC[ST.uf]; if (!u) return;
  const t = ST.turno;
  for (const [c, o] of u.cel) map.setFeatureState({ source: 'celulas', id: c }, { cor: corRes(resumo(o['v' + t], o['p' + t], t)) });
}
function pintar() { pintarMunis(); pintarCelulas(); legenda(); }

// ---------- mapa ----------
function bboxGeom(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = a => { if (typeof a[0] === 'number') { if (a[0] < x0) x0 = a[0]; if (a[0] > x1) x1 = a[0]; if (a[1] < y0) y0 = a[1]; if (a[1] > y1) y1 = a[1]; } else a.forEach(walk); };
  walk(g.coordinates); return [[x0, y0], [x1, y1]];
}
function centroide(g) {
  // centro do maior anel (média ponderada por área)
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best = null, bestA = -1;
  for (const p of polys) {
    const r = p[0]; let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = a ? [cx / (3 * a), cy / (3 * a)] : r[0]; }
  }
  return best;
}
function dentro(pt, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const [x, y] = pt;
  for (const p of polys) {
    let ins = false;
    for (const r of p) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins;
    }
    if (ins) return true;
  }
  return false;
}
function padding() {
  const w = innerWidth;
  if (w <= 760) return { top: 150, bottom: Math.round(innerHeight * 0.48), left: 24, right: 24 };
  return { top: 40, bottom: 40, left: Math.min(440, w * 0.3), right: Math.min(420, w * 0.3) };
}

// Mapa de ruas (só fora do Claude): OpenFreeMap, gratuito e sem chave. Ruas e água ficam por baixo das áreas;
// nomes de ruas e rios ficam por cima. Se o serviço não responder em 5 s, o mapa segue sem ruas.
async function estiloRuas() {
  const esc = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://tiles.openfreemap.org/styles/${esc ? 'dark' : 'positron'}`, { signal: ctl.signal }); clearTimeout(t);
    if (!r.ok) throw new Error(r.status);
    const st = await r.json();
    const fonte = Object.keys(st.sources).find(k => st.sources[k].type === 'vector');
    const da = l => l.source === fonte;
    const below = st.layers.filter(l => da(l) && (l.type === 'fill' || l.type === 'line') && ['water', 'waterway', 'transportation'].includes(l['source-layer']));
    const above = st.layers.filter(l => da(l) && l.type === 'symbol' && ['transportation_name', 'water_name', 'waterway'].includes(l['source-layer']) && !(l.layout || {})['icon-image']);
    return { glyphs: st.glyphs, fonte, src: st.sources[fonte], below, above };
  } catch (e) { return null; }
}

function montarMapa(ruas) {
  const munis = topojson.feature(MAPA, MAPA.objects.municipios);
  munis.features.forEach(f => { f.id = f.properties.codarea; MUNI_FEAT[f.properties.codarea] = f; });
  const estados = topojson.feature(MAPA, MAPA.objects.estados);
  estados.features.forEach(f => { UF_FEAT[f.properties.uf] = f; });
  const style = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': COR.bg } }] };
  if (ruas) { style.glyphs = ruas.glyphs; style.sources[ruas.fonte] = ruas.src; style.layers.push(...ruas.below); }
  map = new maplibregl.Map({
    container: 'map', style, bounds: [[-74, -34], [-34.5, 5.5]], fitBoundsOptions: { padding: padding() },
    maxBounds: [[-100, -45], [-15, 15]], dragRotate: false, pitchWithRotate: false, attributionControl: false, minZoom: 2.5, maxZoom: 17
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Dados: TSE, IBGE' }), 'bottom-right');
  map.on('load', () => {
    const op = ruas ? 0.78 : 1;
    map.addSource('munis', { type: 'geojson', data: munis, promoteId: 'codarea', tolerance: 0.2 });
    map.addSource('estados', { type: 'geojson', data: estados, tolerance: 0.3 });
    map.addSource('celulas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'c', tolerance: 0.25 });
    map.addSource('pontos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'munis-fill', type: 'fill', source: 'munis', paint: { 'fill-color': ['coalesce', ['feature-state', 'cor'], COR.land], 'fill-opacity': op } });
    map.addLayer({ id: 'cel-fill', type: 'fill', source: 'celulas', paint: { 'fill-color': ['coalesce', ['feature-state', 'cor'], COR.land], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, op, 15, ruas ? 0.6 : 1] } });
    map.addLayer({ id: 'cel-line', type: 'line', source: 'celulas', paint: { 'line-color': COR['cell-line'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 10, 0.4, 14, 1.2], 'line-opacity': 0.9 } });
    map.addLayer({ id: 'munis-line', type: 'line', source: 'munis', paint: { 'line-color': COR['muni-line'], 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.08, 6, 0.35, 9, 0.9, 13, 1.6], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.35, 8, 0.7] } });
    map.addLayer({ id: 'estados-line', type: 'line', source: 'estados', paint: { 'line-color': COR['uf-line'], 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1.6, 12, 2.4] } });
    map.addLayer({ id: 'pontos', type: 'circle', source: 'pontos', minzoom: 11, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.4, 15, 4], 'circle-color': ['case', ['==', ['get', 'f'], 0], COR.ink, COR.panel], 'circle-stroke-color': ['case', ['==', ['get', 'f'], 0], COR.panel, COR.ink], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 1.2] } });
    map.addLayer({ id: 'muni-sel', type: 'line', source: 'munis', filter: ['==', ['get', 'codarea'], ''], paint: { 'line-color': COR.ink, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 12, 3] } });
    map.addLayer({ id: 'cel-hover', type: 'line', source: 'celulas', filter: ['==', ['get', 'c'], -1], paint: { 'line-color': COR.ink, 'line-width': 1, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'cel-sel', type: 'line', source: 'celulas', filter: ['==', ['get', 'c'], -1], paint: { 'line-color': COR.ink, 'line-width': 3 } });
    if (ruas) ruas.above.forEach(l => map.addLayer(l));
    pintar();
    eventosMapa();
    rotulos();
    map.on('moveend', rotulos);
    carregando(false);
    abrirHash();
  });
}

function aplicarTema() {
  lerCores();
  if (!map || !map.getLayer('bg')) return;
  map.setPaintProperty('bg', 'background-color', COR.bg);
  map.setPaintProperty('cel-line', 'line-color', COR['cell-line']);
  map.setPaintProperty('munis-line', 'line-color', COR['muni-line']);
  map.setPaintProperty('estados-line', 'line-color', COR['uf-line']);
  for (const id of ['muni-sel', 'cel-hover', 'cel-sel']) map.setPaintProperty(id, 'line-color', COR.ink);
  map.setPaintProperty('pontos', 'circle-color', ['case', ['==', ['get', 'f'], 0], COR.ink, COR.panel]);
  map.setPaintProperty('pontos', 'circle-stroke-color', ['case', ['==', ['get', 'f'], 0], COR.panel, COR.ink]);
  map.setPaintProperty('munis-fill', 'fill-color', ['coalesce', ['feature-state', 'cor'], COR.land]);
  map.setPaintProperty('cel-fill', 'fill-color', ['coalesce', ['feature-state', 'cor'], COR.land]);
  pintar(); render();
}

// ---------- rótulos (sem fontes vetoriais: marcadores HTML com anti-colisão) ----------
let marcadores = [];
function rotulos() {
  marcadores.forEach(m => m.remove()); marcadores = [];
  const z = map.getZoom(), b = map.getBounds(), W = innerWidth, H = innerHeight;
  const ocup = [];
  const cabe = (p, w, h) => {
    const r = [p.x - w / 2 - 4, p.y - h / 2 - 3, p.x + w / 2 + 4, p.y + h / 2 + 3];
    if (r[0] < 0 || r[1] < 0 || r[2] > W || r[3] > H) return false;
    for (const o of ocup) if (!(r[2] < o[0] || r[0] > o[2] || r[3] < o[1] || r[1] > o[3])) return false;
    ocup.push(r); return true;
  };
  const add = (xy, txt, cls, px) => {
    const p = map.project(xy); const w = txt.length * px, h = px * 1.9;
    if (!cabe(p, w, h)) return false;
    const el = document.createElement('div'); el.className = 'rotulo ' + cls; el.textContent = txt;
    marcadores.push(new maplibregl.Marker({ element: el }).setLngLat(xy).addTo(map)); return true;
  };
  if (z < 5.2) {
    for (const cod in UF_FEAT) { const c = UF_FEAT[cod].__c || (UF_FEAT[cod].__c = centroide(UF_FEAT[cod].geometry)); add(c, UFSIG[cod], 'uf', 9); }
    return;
  }
  if (z < 11.5) {
    const lim = z < 7 ? 25 : 45; let n = 0;
    for (const m of MUNI_LIST) {
      if (n >= lim) break;
      const f = MUNI_FEAT[m.g]; if (!f) continue;
      const c = f.__c || (f.__c = centroide(f.geometry));
      if (!b.contains(c)) continue;
      if (z < 7 && m.aptos < 150000) break;
      if (add(c, m.n, 'mun', 6.6)) n++;
    }
  }
  const u = UFC[ST.uf];
  if (u && z >= 11.5) {
    let n = 0;
    for (const bb of u.bairros) {
      if (n >= 55) break;
      if (!b.contains(bb.xy)) continue;
      if (add(bb.xy, bb.nome.toUpperCase(), 'bairro', 7.2)) n++;
    }
  }
}

// ---------- interação com o mapa ----------
const ehToque = matchMedia('(hover: none)').matches;
function eventosMapa() {
  const tip = $('#tip');
  let hoverC = -1;
  map.on('mousemove', e => {
    if (ehToque) return;
    const f = map.queryRenderedFeatures(e.point, { layers: ['cel-fill', 'munis-fill'] })[0];
    if (!f) { tip.hidden = true; map.getCanvas().style.cursor = ''; if (hoverC !== -1) { hoverC = -1; map.setFilter('cel-hover', ['==', ['get', 'c'], -1]); } return; }
    map.getCanvas().style.cursor = 'pointer';
    let html = '';
    if (f.layer.id === 'cel-fill') {
      const c = f.properties.c, o = UFC[ST.uf].cel.get(c);
      if (c !== hoverC) { hoverC = c; map.setFilter('cel-hover', ['==', ['get', 'c'], c]); }
      if (!o) { tip.hidden = true; return; }
      const l0 = UFC[ST.uf].d.locais[o.ids[0]];
      const r = resumo(o['v' + ST.turno], o['p' + ST.turno], ST.turno);
      html = `<div class="tn">${esc(titulo(l0[3]))}${o.ids.length > 1 ? ` <span class="tv">+${o.ids.length - 1}</span>` : ''}</div><div class="tv">${esc(titulo(l0[5]))}</div>${linhaTip(r)}`;
    } else {
      if (hoverC !== -1) { hoverC = -1; map.setFilter('cel-hover', ['==', ['get', 'c'], -1]); }
      const g = f.properties.codarea, G = GEO[g];
      html = `<div class="tn">${esc(G.nome)} <span class="tv">${esc(G.uf)}</span></div>${linhaTip(resumo(G['v' + ST.turno], G['p' + ST.turno], ST.turno))}`;
    }
    tip.innerHTML = html; tip.hidden = false;
    const x = e.originalEvent.clientX, y = e.originalEvent.clientY, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(x + 14, innerWidth - tw - 8) + 'px'; tip.style.top = Math.min(y + 14, innerHeight - th - 8) + 'px';
  });
  map.getCanvas().addEventListener('mouseleave', () => { tip.hidden = true; });
  map.on('click', e => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['cel-fill', 'munis-fill'] })[0];
    if (!f) return;
    if (f.layer.id === 'cel-fill') selecionarCelula(f.properties.c, false);
    else { const ibs = GEO[f.properties.codarea].ibges; selecionarMuni(ibs[0]); }
  });
}
function linhaTip(r) {
  const t = ST.turno;
  if (!r || !r.validos) return '<div class="tv">Sem votação neste turno</div>';
  if (ST.modo === 'cand') { const i = IDX[t][ST.cand]; return `<div class="tv">${esc(nomeC(ST.cand))}: ${pct(r.v[i] / r.validos)}</div>`; }
  if (r.tie) return '<div class="tv">Empate</div>';
  return `<div class="tv">${esc(nomeC(CANDS[t][r.w][0]))} ${pct(r.wShare)}</div>`;
}

// ---------- navegação ----------
function irPara(bounds, maxZoom = 14) { map.fitBounds(bounds, { padding: padding(), maxZoom, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900 }); }
function selecionarBrasil() {
  Object.assign(ST, { nivel: 'br', muni: null, cel: null });
  map.setFilter('muni-sel', ['==', ['get', 'codarea'], '']); map.setFilter('cel-sel', ['==', ['get', 'c'], -1]);
  irPara([[-74, -34], [-34.5, 5.5]]); render();
}
async function selecionarUF(uf) {
  Object.assign(ST, { nivel: 'uf', muni: null, cel: null });
  map.setFilter('muni-sel', ['==', ['get', 'codarea'], '']); map.setFilter('cel-sel', ['==', ['get', 'c'], -1]);
  irPara(bboxGeom(UF_FEAT[UFCOD[uf]].geometry), 9); render();
  await ativarUF(uf); render();
}
async function selecionarMuni(ibge, voar = true) {
  const m = BR.munis[ibge]; if (!m) return;
  Object.assign(ST, { nivel: 'muni', muni: ibge, cel: null });
  map.setFilter('muni-sel', ['==', ['get', 'codarea'], m.g]); map.setFilter('cel-sel', ['==', ['get', 'c'], -1]);
  if (voar && MUNI_FEAT[m.g]) irPara(bboxGeom(MUNI_FEAT[m.g].geometry), 13);
  render();
  await ativarUF(m.uf); render();
  try { history.replaceState(null, '', '#' + ibge); } catch (e) {}
}
async function selecionarCelula(c, voar = true) {
  const u = UFC[ST.uf]; const o = u && u.cel.get(c); if (!o) return;
  const l0 = u.d.locais[o.ids[0]]; const mun = u.d.munis[l0[0]];
  Object.assign(ST, { nivel: 'cel', muni: mun.ibge, cel: c });
  map.setFilter('muni-sel', ['==', ['get', 'codarea'], mun.g]);
  map.setFilter('cel-sel', ['==', ['get', 'c'], c]);
  if (voar) {
    const f = u.fc.features.find(f => f.properties.c === c);
    if (f) irPara(bboxGeom(f.geometry), 15);
  }
  expandirPainel(); render();
}
async function irParaPonto(xy, ibge) {
  const m = BR.munis[ibge]; if (!m) return;
  const u = await ativarUF(m.uf);
  // célula do local mais próximo no mesmo município (equivale à célula de Voronoi que contém o ponto)
  const mi = u.muniIdx[ibge]; let best = -1, bd = Infinity;
  for (const i of u.d.munis[mi].locais) { const l = u.d.locais[i]; if (!l[9] || l[7] < 0) continue; const dx = (l[9][0] - xy[0]) * Math.cos(xy[1] * Math.PI / 180), dy = l[9][1] - xy[1]; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = l[7]; } }
  if (best >= 0) { map.flyTo({ center: xy, zoom: 13.6, padding: padding(), duration: 900 }); selecionarCelula(best, false); }
  else selecionarMuni(ibge);
}
function abrirHash() {
  const h = (location.hash || '').slice(1);
  if (/^\d{7}$/.test(h) && BR.munis[h]) selecionarMuni(h);
}

// ---------- painel ----------
function expandirPainel() { $('#painel').classList.remove('recolhido'); }
function migalhas() {
  const p = [];
  p.push(ST.nivel === 'br' ? '<span>Brasil</span>' : '<button type="button" data-ir="br">Brasil</button>');
  const uf = ST.nivel === 'uf' ? ST.uf : (ST.muni ? BR.munis[ST.muni].uf : null);
  if (uf) p.push('<span class="sep">/</span>', ST.nivel === 'uf' ? `<span>${uf}</span>` : `<button type="button" data-ir="uf" data-uf="${uf}">${uf}</button>`);
  if (ST.muni) p.push('<span class="sep">/</span>', ST.nivel === 'muni' ? `<span>${esc(BR.munis[ST.muni].n)}</span>` : `<button type="button" data-ir="muni">${esc(BR.munis[ST.muni].n)}</button>`);
  if (ST.nivel === 'cel') p.push('<span class="sep">/</span><span>local</span>');
  $('#migalhas').innerHTML = p.join(' ');
}
function blocoResultado(r, ref, refNome) {
  const t = ST.turno;
  if (!r || !r.v) return '<p class="dica">Não houve votação neste local no ' + t + 'º turno. Troque o turno no alto da tela.</p>';
  const n = r.v.length - 2;
  const ordem = [...Array(n).keys()].sort((a, b) => r.v[b] - r.v[a]);
  const vis = t === 2 ? ordem : ordem.slice(0, 5);
  const linhas = (lst) => lst.map(i => {
    const nr = CANDS[t][i][0], s = r.validos ? r.v[i] / r.validos : 0;
    const rs = ref && ref.validos ? ref.v[i] / ref.validos : null;
    const cor = corCand(nr);
    return `<div class="cand${i === r.w && !r.tie && r.validos ? ' vence' : ''}"><div class="nome"><span>${esc(nomeC(nr))}</span><small>${nr} · ${esc(CAND[nr]?.[1] || '')}</small></div><div class="num">${pct(s)}</div>
      <div class="barra"><i style="width:${(s * 100).toFixed(2)}%;background:${cor}"></i>${rs != null ? `<b style="left:calc(${(rs * 100).toFixed(2)}% - 1px)" title="${esc(refNome)}: ${pct(rs)}"></b>` : ''}</div>
      <div class="det">${fmt(r.v[i])} votos${rs != null ? ` · ${esc(refNome)} ${pct(rs)}` : ''}</div></div>`;
  }).join('');
  let h = `<div class="cands">${linhas(vis)}</div>`;
  if (vis.length < n) h += `<div id="maisCands" hidden><div class="cands">${linhas(ordem.slice(5).filter(i => r.v[i] > 0 || true))}</div></div><button class="mais" type="button" data-mais>Ver os ${n} candidatos</button>`;
  if (ref) h += `<div class="ref"><b></b> marca o resultado de ${esc(refNome)}</div>`;
  const total = r.validos + r.brancos + r.nulos;
  h += '<hr class="tracejado"><dl class="tabela">';
  h += `<dt>Votos válidos</dt><dd>${fmt(r.validos)}</dd><dt>Brancos</dt><dd>${fmt(r.brancos)} · ${pct(total ? r.brancos / total : 0)}</dd><dt>Nulos</dt><dd>${fmt(r.nulos)} · ${pct(total ? r.nulos / total : 0)}</dd>`;
  if (r.aptos) h += `<dt>Eleitores aptos</dt><dd>${fmt(r.aptos)}</dd><dt>Comparecimento</dt><dd>${fmt(r.comp)} · ${pct(r.comp / r.aptos)}</dd><dt>Abstenção</dt><dd>${fmt(r.aptos - r.comp)} · ${pct(1 - r.comp / r.aptos)}</dd>`;
  if (r.secoes) h += `<dt>Seções</dt><dd>${fmt(r.secoes)}</dd>`;
  return h + '</dl>';
}
function manchete(r, onde) {
  const t = ST.turno;
  if (!r || !r.validos) return '';
  if (r.tie) return `<div class="manchete"><span class="chip" style="background:${COR.empate}"></span><span class="q">${t}º turno ${esc(onde)}</span><span class="r">Empate</span></div>`;
  const nr = CANDS[t][r.w][0];
  let seg = -1; for (let i = 0; i < r.v.length - 2; i++) if (i !== r.w && (seg < 0 || r.v[i] > r.v[seg])) seg = i;
  const margem = r.validos ? (r.v[r.w] - r.v[seg]) / r.validos : 0;
  return `<div class="manchete"><span class="chip" style="background:${corCand(nr)}"></span><span class="q">${t}º turno ${esc(onde)}</span><span class="r">${esc(nomeC(nr))} venceu com ${pct(r.wShare)}, ${(margem * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pontos à frente</span></div>`;
}
function vencedorCor(v, p) { const r = resumo(v, p, ST.turno); return { r, cor: r && r.validos && !r.tie ? corCand(CANDS[ST.turno][r.w][0]) : COR.empate }; }

function render() {
  migalhas();
  const t = ST.turno, corpo = $('#corpo');
  let h = '';
  const nac = resumo(BR.tot['v' + t], BR.tot['p' + t], t);
  if (ST.nivel === 'br') {
    h += `<div class="bu-cab"><span>Presidente · ${t}º turno</span><span>Brasil</span></div><h2>Resultado no Brasil</h2>`;
    h += manchete(nac, 'no país') + blocoResultado(nac);
    if (BR.exterior) h += `<p class="dica">Inclui ${fmt(BR.extTot['v' + t].reduce((a, b) => a + b, 0))} votos do exterior, que não aparecem no mapa.</p>`;
    h += '<div class="secao-tit"><span>Estados</span><span>vencedor</span></div><ul class="lista">';
    const ufs = Object.keys(BR.ufs).sort();
    for (const uf of ufs) { const U = BR.ufs[uf]; const { r, cor } = vencedorCor(U['v' + t], U['p' + t]); h += `<li><button type="button" data-uf="${uf}"><span class="dot" style="background:${cor}"></span><span class="l1">${NOME_UF[uf]}</span><span class="l2">${esc(nomeC(CANDS[t][r.w][0]))}</span><span class="v">${pct(r.wShare)}</span></button></li>`; }
    h += '</ul><p class="dica">Clique num município do mapa ou busque uma cidade, bairro, escola ou CEP para ver cada local de votação.</p>';
  } else if (ST.nivel === 'uf') {
    const U = BR.ufs[ST.uf], r = resumo(U['v' + t], U['p' + t], t);
    h += `<div class="bu-cab"><span>Presidente · ${t}º turno</span><span>${ST.uf}</span></div><h2>${NOME_UF[ST.uf]}</h2>`;
    h += manchete(r, 'no estado') + blocoResultado(r, nac, 'Brasil');
    const ms = MUNI_LIST.filter(m => m.uf === ST.uf);
    h += `<div class="secao-tit"><span>Municípios (${ms.length})</span><span>vencedor</span></div><input class="filtro" id="filtroLista" type="search" placeholder="Filtrar municípios" aria-label="Filtrar municípios"><ul class="lista" id="lista"></ul>`;
    corpo.innerHTML = h; listaMunis(ms); posRender(); return;
  } else if (ST.nivel === 'muni') {
    const m = BR.munis[ST.muni], r = resumo(m['v' + t], m['p' + t], t);
    const U = BR.ufs[m.uf], ru = resumo(U['v' + t], U['p' + t], t);
    h += `<div class="bu-cab"><span>Presidente · ${t}º turno</span><span>${m.uf}</span></div><h2>${esc(m.n)}</h2>`;
    h += manchete(r, 'no município') + blocoResultado(r, ru, m.uf);
    const u = UFC[m.uf];
    if (!u) h += '<p class="dica">Carregando locais de votação…</p>';
    else {
      const mi = u.muniIdx[ST.muni], lst = u.d.munis[mi].locais;
      h += `<div class="secao-tit"><span>Locais de votação (${lst.length})</span><span>vencedor</span></div><input class="filtro" id="filtroLista" type="search" placeholder="Filtrar por escola, bairro ou endereço" aria-label="Filtrar locais"><ul class="lista" id="lista"></ul>`;
      corpo.innerHTML = h; listaLocais(u, lst); posRender(); return;
    }
  } else if (ST.nivel === 'cel') {
    const u = UFC[ST.uf], o = u.cel.get(ST.cel);
    const ls = o.ids.map(i => u.d.locais[i]);
    const m = u.d.munis[ls[0][0]];
    const r = resumo(o['v' + t], o['p' + t], t);
    const rm = resumo(m['v' + t], m['p' + t], t);
    const l0 = ls[0];
    h += `<div class="bu-cab"><span>Boletim do local · ${t}º turno</span><span>Zona ${l0[1]}</span></div>`;
    h += `<h2>${esc(titulo(l0[3]))}</h2><p class="end">${esc(titulo(l0[4]))}${l0[5] ? ' · ' + esc(titulo(l0[5])) : ''}${l0[6] ? ' · CEP ' + fmtCep(l0[6]) : ''}<br>${esc(m.n)} (${ST.uf})</p>`;
    if (ls.length > 1) h += `<div class="aviso">${ls.length} locais de votação funcionam neste endereço. O resultado abaixo soma todos.</div>`;
    if (ls.some(l => l[8] === 1)) h += '<div class="aviso">A coordenada do TSE para este local estava ausente ou fora do município. A posição foi estimada pelo CEP.</div>';
    h += manchete(r, 'neste local') + blocoResultado(r, rm, m.n);
    if (ls.length > 1) {
      h += '<div class="secao-tit"><span>Locais neste endereço</span><span>vencedor</span></div><ul class="lista">';
      for (const l of ls) { const { r: rr, cor } = vencedorCor(l[t === 1 ? 10 : 12], l[t === 1 ? 11 : 13]); h += `<li><button type="button" tabindex="-1"><span class="dot" style="background:${cor}"></span><span class="l1">${esc(titulo(l[3]))}</span><span class="l2">Zona ${l[1]} · local ${l[2]}</span><span class="v">${rr && rr.validos ? pct(rr.wShare) : '—'}</span></button></li>`; }
      h += '</ul>';
    }
    h += `<div class="serrilha" role="presentation"></div><p class="dica">A área colorida reúne os pontos mais próximos deste local do que de qualquer outro do município. É uma aproximação da vizinhança, não o endereço dos eleitores.</p>`;
  }
  corpo.innerHTML = h; posRender();
}
function posRender() {
  const b = $('[data-mais]'); if (b) b.onclick = () => { $('#maisCands').hidden = false; b.remove(); };
}
function listaMunis(ms) {
  const t = ST.turno, ul = $('#lista'), inp = $('#filtroLista');
  const desenha = () => {
    const q = norm(inp.value);
    const f = q ? ms.filter(m => m.nn.includes(q)) : ms;
    ul.innerHTML = f.slice(0, 250).map(m => { const { r, cor } = vencedorCor(m.ref['v' + t], m.ref['p' + t]); return `<li><button type="button" data-muni="${m.ibge}"><span class="dot" style="background:${cor}"></span><span class="l1">${esc(m.n)}</span><span class="l2">${fmt(m.aptos)} eleitores · ${esc(nomeC(CANDS[t][r.w][0]))}</span><span class="v">${pct(r.wShare)}</span></button></li>`; }).join('') + (f.length > 250 ? `<li class="dica">Mostrando 250 de ${f.length}. Use o filtro.</li>` : '');
  };
  inp.oninput = desenha; desenha();
}
function listaLocais(u, lst) {
  const t = ST.turno, ul = $('#lista'), inp = $('#filtroLista');
  const it = lst.map(i => { const l = u.d.locais[i]; return { i, l, k: norm(l[3] + ' ' + l[4] + ' ' + l[5] + ' ' + l[6]), ap: ((t === 1 ? l[11] : l[13]) || [0])[0] }; }).sort((a, b) => b.ap - a.ap);
  const desenha = () => {
    const q = norm(inp.value);
    const f = q ? it.filter(x => x.k.includes(q)) : it;
    ul.innerHTML = f.slice(0, 300).map(({ l }) => {
      const { r, cor } = vencedorCor(l[t === 1 ? 10 : 12], l[t === 1 ? 11 : 13]);
      const sem = l[7] < 0;
      return `<li><button type="button" ${sem ? 'disabled' : `data-cel="${l[7]}"`}><span class="dot" style="background:${r && r.validos ? cor : COR.land}"></span><span class="l1">${esc(titulo(l[3]))}</span><span class="l2">${esc(titulo(l[5]) || titulo(l[4]))}${sem ? ' · sem posição no mapa' : ''}</span><span class="v">${r && r.validos ? pct(r.wShare) : '—'}</span></button></li>`;
    }).join('') + (f.length > 300 ? `<li class="dica">Mostrando 300 de ${f.length}. Use o filtro.</li>` : '') + (!f.length ? '<li class="dica">Nenhum local encontrado.</li>' : '');
  };
  inp.oninput = desenha; desenha();
}
$('#corpo').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.uf) selecionarUF(b.dataset.uf);
  else if (b.dataset.muni) selecionarMuni(b.dataset.muni);
  else if (b.dataset.cel) selecionarCelula(+b.dataset.cel, true);
});
$('#migalhas').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.ir === 'br') selecionarBrasil();
  else if (b.dataset.ir === 'uf') selecionarUF(b.dataset.uf);
  else if (b.dataset.ir === 'muni') selecionarMuni(ST.muni);
});
$('#alca').addEventListener('click', () => $('#painel').classList.toggle('recolhido'));

// ---------- legenda ----------
function legenda() {
  const t = ST.turno, el = $('#legenda');
  let h = '';
  if (ST.modo === 'vencedor') {
    h += `<div class="tit">Vencedor no local · % dos válidos</div>`;
    const vencedores = t === 2 ? [13, 22] : [13, 22, 55];
    for (const nr of vencedores) h += `<div class="leg-linha"><span>${esc(nomeC(nr))}</span><span class="leg-rampa">${ALF_V.map(a => `<i style="background:${mix(corCand(nr), COR.land, a)}"></i>`).join('')}</span></div>`;
    h += `<div class="leg-escala"><span></span><div>${LBL_V[t].map(x => `<span>${x}</span>`).join('')}</div></div>`;
  } else {
    const bins = binsCand(ST.cand), lab = ['0', ...bins.map(b => String(Math.round(b * 100)))].map((x, i) => i === 5 ? x + '+' : x);
    h += `<div class="tit">${esc(nomeC(ST.cand))} · % dos válidos</div>`;
    h += `<div class="leg-linha"><span>${esc(nomeC(ST.cand))}</span><span class="leg-rampa">${ALF_C.map(a => `<i style="background:${mix(corModoCand(ST.cand), COR.land, a)}"></i>`).join('')}</span></div>`;
    h += `<div class="leg-escala"><span></span><div>${lab.map(x => `<span>${x}</span>`).join('')}</div></div>`;
  }
  h += `<div class="leg-extra">${ST.modo === 'vencedor' ? `<span><i style="background:${COR.empate}"></i>Empate</span>` : ''}<span><i style="background:${COR.land}"></i>Sem votação</span></div>`;
  el.innerHTML = h;
}

// ---------- controles ----------
function preencherSelect() {
  const sel = $('#selCand'), t = ST.turno;
  sel.innerHTML = CANDS[t].filter(c => c[0] < 90).map(c => `<option value="${c[0]}">${esc(nomeC(c[0]))} (${c[0]})</option>`).join('');
  if (IDX[t][ST.cand] == null) ST.cand = 13;
  sel.value = ST.cand;
}
$$('[data-turno]').forEach(b => b.addEventListener('click', () => {
  ST.turno = +b.dataset.turno; $$('[data-turno]').forEach(x => x.setAttribute('aria-pressed', x === b));
  preencherSelect(); pintar(); render();
}));
$$('[data-modo]').forEach(b => b.addEventListener('click', () => {
  ST.modo = b.dataset.modo; $$('[data-modo]').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('#selCand').hidden = ST.modo !== 'cand'; pintar(); render();
}));
$('#selCand').addEventListener('change', e => { ST.cand = +e.target.value; pintar(); render(); });

// ---------- busca ----------
const inp = $('#busca'), ulr = $('#resultados');
let itens = [], selI = -1, tBusca;
function fecharBusca() { ulr.hidden = true; $('#buscaBox').setAttribute('aria-expanded', 'false'); selI = -1; }
function mostrar(lista, vazio) {
  itens = lista; selI = lista.length ? 0 : -1;
  ulr.innerHTML = lista.length ? lista.map((x, i) => `<li role="option" id="op${i}" aria-selected="${i === selI}" data-i="${i}"><span class="tipo">${x.tipo}</span><span class="t1">${esc(x.t1)}</span><span class="t2">${esc(x.t2)}</span></li>`).join('') : `<li class="vazio">${esc(vazio || 'Nada encontrado.')}</li>`;
  ulr.hidden = false; $('#buscaBox').setAttribute('aria-expanded', 'true');
}
async function buscar(qraw) {
  const q = norm(qraw);
  if (!q) { fecharBusca(); return; }
  const dig = qraw.replace(/\D/g, '');
  if (/^\d{5}-?\d{0,3}$/.test(qraw.trim()) && dig.length >= 5) {
    if (!CEP) { try { CEP = await getJSON('data/cep.json'); } catch (e) { CEP = {}; } }
    const c5 = dig.slice(0, 5), e = CEP[c5];
    if (e) { const m = BR.munis[e[2]]; mostrar([{ tipo: 'CEP', t1: `${c5}-${dig.slice(5) || 'xxx'}`, t2: `Área do CEP em ${m.n} (${m.uf})`, acao: () => irParaPonto([e[0], e[1]], e[2]) }]); }
    else mostrar([], 'Nenhum local de votação com esse início de CEP. Tente a busca pelo nome da cidade.');
    return;
  }
  const cidades = [], curB = [], curL = [], outB = [], outL = [];
  const ms = [];
  for (const m of MUNI_LIST) { const i = m.nn.indexOf(q); if (i === 0) ms.push([m.nn === q ? 0 : 1, m]); else if (i > 0) ms.push([2, m]); }
  ms.sort((a, b) => a[0] - b[0] || b[1].aptos - a[1].aptos);
  ms.slice(0, 5).forEach(([, m]) => cidades.push({ tipo: 'Cidade', t1: m.n, t2: `${NOME_UF[m.uf]} · ${fmt(m.aptos)} eleitores`, acao: () => selecionarMuni(m.ibge) }));
  const u = UFC[ST.uf];
  if (u && q.length >= 3) {
    const atual = ST.muni && u.muniIdx[ST.muni] != null ? u.muniIdx[ST.muni] : -1;
    const bs = u.bairros.filter(b => norm(b.nome).includes(q)).sort((a, b) => (norm(b.nome).startsWith(q)) - (norm(a.nome).startsWith(q)) || b.w - a.w);
    for (const b of bs) { const m = u.d.munis[b.m]; const it = { tipo: 'Bairro', t1: titulo(b.nome), t2: `${m.n} (${u.uf}) · ${b.n} ${b.n > 1 ? 'locais' : 'local'}`, acao: () => irParaPonto(b.xy, m.ibge) }; (b.m === atual ? curB : outB).push(it); }
    let n = 0;
    for (const l of u.d.locais) {
      if (l[7] < 0) continue; const k = norm(l[3] + ' ' + l[4]); if (!k.includes(q)) continue;
      const m = u.d.munis[l[0]]; const it = { tipo: 'Local', t1: titulo(l[3]), t2: `${titulo(l[4])} · ${m.n}`, acao: () => selecionarCelula(l[7], true) };
      (l[0] === atual ? curL : outL).push(it); if (++n > 300) break;
    }
  }
  const out = [...curB.slice(0, 4), ...cidades, ...curL.slice(0, 5), ...outB.slice(0, 3), ...outL.slice(0, 3)];
  if (EXTERNO && q.length >= 6) out.push({ tipo: 'Endereço', t1: `Procurar “${qraw}”`, t2: 'Endereço no OpenStreetMap', acao: () => nominatim(qraw) });
  mostrar(out, u ? 'Nada encontrado. Tente o nome da cidade, do bairro, da escola ou um CEP.' : 'Nada encontrado. Escolha uma cidade para buscar bairros e escolas, ou digite um CEP.');
}
async function nominatim(q) {
  try {
    const r = await getJSON('https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=' + encodeURIComponent(q));
    if (!r[0]) return mostrar([], 'Endereço não encontrado.');
    pontoLivre([+r[0].lon, +r[0].lat]);
  } catch (e) { mostrar([], 'A busca de endereço não está disponível agora.'); }
}
function pontoLivre(xy) {
  for (const m of MUNI_LIST) {
    const f = MUNI_FEAT[m.g]; if (!f) continue;
    const bb = f.__bb || (f.__bb = bboxGeom(f.geometry));
    if (xy[0] < bb[0][0] || xy[0] > bb[1][0] || xy[1] < bb[0][1] || xy[1] > bb[1][1]) continue;
    if (dentro(xy, f.geometry)) return irParaPonto(xy, m.ibge);
  }
  mostrar([], 'Esse ponto fica fora dos municípios do mapa.');
}
inp.addEventListener('input', () => { clearTimeout(tBusca); tBusca = setTimeout(() => buscar(inp.value), 120); });
inp.addEventListener('keydown', e => {
  if (ulr.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!itens.length) return; selI = (selI + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length; $$('li[role=option]', ulr).forEach((li, i) => li.setAttribute('aria-selected', i === selI)); inp.setAttribute('aria-activedescendant', 'op' + selI); }
  else if (e.key === 'Enter') { e.preventDefault(); if (itens[selI]) { const a = itens[selI].acao; fecharBusca(); inp.blur(); a(); } }
  else if (e.key === 'Escape') fecharBusca();
});
ulr.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (!li) return; e.preventDefault(); const a = itens[+li.dataset.i].acao; fecharBusca(); inp.blur(); a(); });
inp.addEventListener('blur', () => setTimeout(fecharBusca, 150));
inp.addEventListener('focus', () => { if (inp.value) buscar(inp.value); });
$('#btnGeo').addEventListener('click', () => {
  const falha = () => { inp.focus(); mostrar([], 'Não foi possível usar sua localização aqui. Digite seu CEP ou o nome do bairro.'); };
  if (!navigator.geolocation) return falha();
  try { navigator.geolocation.getCurrentPosition(p => pontoLivre([p.coords.longitude, p.coords.latitude]), falha, { timeout: 8000 }); } catch (e) { falha(); }
});

// ---------- sobre ----------
$('#abrirSobre').addEventListener('click', () => { $('#sobreFundo').hidden = false; $('#fecharSobre').focus(); });
$('#fecharSobre').addEventListener('click', () => { $('#sobreFundo').hidden = true; $('#abrirSobre').focus(); });
$('#sobreFundo').addEventListener('click', e => { if (e.target.id === 'sobreFundo') $('#sobreFundo').hidden = true; });
addEventListener('keydown', e => { if (e.key === 'Escape') $('#sobreFundo').hidden = true; });

const NOME_UF = { AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins' };

// ---------- início ----------
async function iniciar() {
  lerCores();
  let ruas;
  [BR, MAPA, ruas] = await Promise.all([getJSON('data/brasil.json'), getJSON('data/brasil_mapa.json'), EXTERNO ? estiloRuas() : null]);
  CANDS = { 1: BR.cands['1'], 2: BR.cands['2'] };
  IDX = { 1: {}, 2: {} }; for (const t of [1, 2]) CANDS[t].forEach((c, i) => IDX[t][c[0]] = i);
  BR.tot = { v1: null, v2: null, p1: null, p2: null };
  for (const uf in BR.ufs) for (const k of ['v1', 'v2', 'p1', 'p2']) BR.tot[k] = soma(BR.tot[k], BR.ufs[uf][k]);
  BR.extTot = { v1: null, v2: null };
  for (const e of BR.exterior || []) for (const t of [1, 2]) { BR.tot['v' + t] = soma(BR.tot['v' + t], e['v' + t]); BR.tot['p' + t] = somaP(BR.tot['p' + t], [...e['p' + t], 0]); BR.extTot['v' + t] = soma(BR.extTot['v' + t], e['v' + t]); }
  for (const t of [1, 2]) { const r = resumo(BR.tot['v' + t], null, t); NAC[t] = {}; CANDS[t].forEach((c, i) => NAC[t][c[0]] = r.validos ? r.v[i] / r.validos : 0); }
  for (const ib in BR.munis) {
    const m = BR.munis[ib]; UFCOD[m.uf] = ib.slice(0, 2); UFSIG[ib.slice(0, 2)] = m.uf;
    const G = GEO[m.g] || (GEO[m.g] = { v1: null, v2: null, p1: null, p2: null, nomes: [], ibges: [], uf: m.uf });
    G.v1 = soma(G.v1, m.v1); G.v2 = soma(G.v2, m.v2); G.p1 = somaP(G.p1, m.p1); G.p2 = somaP(G.p2, m.p2); G.nomes.push(m.n); G.ibges.push(ib);
    MUNI_LIST.push({ ibge: ib, g: m.g, n: m.n, nn: norm(m.n), uf: m.uf, aptos: (m.p2 || m.p1)[0], ref: m });
  }
  for (const g in GEO) GEO[g].nome = GEO[g].nomes.join(' e ');
  MUNI_LIST.sort((a, b) => b.aptos - a.aptos);
  const nAprox = 1147, nSem = 131;
  preencherSelect(); render(); legenda();
  if (EXTERNO) $('#sobreAmbiente').textContent = 'O mapa de ruas vem do OpenFreeMap, com dados do OpenStreetMap. A busca de endereço consulta o Nominatim, do OpenStreetMap, só quando você escolhe “Procurar” na lista.';
  else $('#sobreAmbiente').textContent = 'Nesta versão o mapa é autossuficiente: não carrega mapa de ruas nem serviços externos. A busca usa só os dados do TSE (cidades, bairros, escolas e CEPs dos locais de votação).';
  montarMapa(ruas);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarTema);
  new MutationObserver(aplicarTema).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  addEventListener('hashchange', abrirHash);
  if (innerWidth <= 760) $('#painel').classList.add('recolhido');
}
iniciar().catch(err => { console.error(err); carregando(true, 'Não foi possível carregar os dados. Recarregue a página.'); });
})();
