# Gera, por UF, os polígonos de Voronoi dos locais de votação (recortados no município)
# e os resultados por local, município, UF e Brasil.
import duckdb, json, sys, os, unicodedata, re
from collections import defaultdict, Counter
import numpy as np, shapely
from shapely.geometry import shape, Point, MultiPoint, mapping

DB, IBGE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
con = duckdb.connect(DB, read_only=True)

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().upper()
    return re.sub(r'[^A-Z]', '', s)

# ordem dos candidatos (votos nacionais), brancos e nulos ao final
CANDS = {}
for t in (1, 2):
    rows = con.execute("select nr, any_value(nm), sum(votos) v from votos_local where turno=? and nr not in (95,96) group by nr order by v desc", [t]).fetchall()
    CANDS[t] = [r[0] for r in rows] + [95, 96]
NOMES = dict(con.execute("select nr, any_value(nm) from votos_local group by nr").fetchall())
IDX = {t: {nr: i for i, nr in enumerate(CANDS[t])} for t in (1, 2)}

# votos por local e turno
votos = defaultdict(lambda: {1: None, 2: None})
for t, uf, cd, zona, nl, nr, v in con.execute("select turno, uf, cd_mun, zona, nr_local, nr, votos from votos_local").fetchall():
    arr = votos[(uf, cd, zona, nl)][t]
    if arr is None:
        arr = votos[(uf, cd, zona, nl)][t] = [0] * len(CANDS[t])
    arr[IDX[t][nr]] += v
part = {}
for t, uf, cd, zona, nl, aptos, comp, secoes in con.execute("select turno, uf, cd_mun, zona, nr_local, aptos, comparec, secoes from local_turno").fetchall():
    part[(t, uf, cd, zona, nl)] = (aptos, comp, secoes)

ibge_list = json.load(open(f"{IBGE}/municipios.json"))
def uf_of(m):
    try: return m['microrregiao']['mesorregiao']['UF']['sigla']
    except Exception: return m['regiao-imediata']['regiao-intermediaria']['UF']['sigla']
ibge_nome = {str(m['id']): m['nome'] for m in ibge_list}
ibge_by_name = defaultdict(dict)
for m in ibge_list: ibge_by_name[uf_of(m)][norm(m['nome'])] = str(m['id'])

def soma(a, b):
    if b is None: return a
    if a is None: return list(b)
    return [x + y for x, y in zip(a, b)]

brasil = {'munis': {}, 'ufs': {}, 'cands': {t: [[nr, NOMES[nr]] for nr in CANDS[t]] for t in (1, 2)}}
log = Counter()
UFS = [r[0] for r in con.execute("select distinct uf from locais order by 1").fetchall()]
for uf in UFS:
    locs = con.execute("select cd_mun, nm_mun, zona, nr_local, nome, endereco, bairro, cep, lat, lon from locais where uf=? order by cd_mun, zona, nr_local", [uf]).fetchall()
    if uf == 'ZZ':
        # exterior: sem mapa, só totais por cidade
        ext = {}
        for cd, nm, zona, nl, *_ in locs:
            k = (uf, cd, zona, nl); e = ext.setdefault(nm, {'t': {1: None, 2: None}, 'p': {1: [0, 0], 2: [0, 0]}})
            for t in (1, 2):
                e['t'][t] = soma(e['t'][t], votos[k][t])
                if (t,)+k in part: e['p'][t][0] += part[(t,)+k][0]; e['p'][t][1] += part[(t,)+k][1]
        brasil['exterior'] = [{'n': n, 'v1': e['t'][1], 'v2': e['t'][2], 'p1': e['p'][1], 'p2': e['p'][2]} for n, e in sorted(ext.items())]
        continue
    gj = json.load(open(f"{IBGE}/max_{uf}.geojson"))
    geoms = {f['properties']['codarea']: shapely.make_valid(shape(f['geometry'])) for f in gj['features']}
    codes = list(geoms); tree = shapely.STRtree([geoms[c] for c in codes])
    # TSE -> IBGE: nome; se falhar, maioria espacial
    tse_mun = {}
    for cd, nm, *_ in locs: tse_mun[cd] = nm
    tse2ibge, tse2geo = {}, {}
    for cd, nm in tse_mun.items():
        c = ibge_by_name[uf].get(norm(nm))
        if c in geoms: tse2ibge[cd] = tse2geo[cd] = c; continue
        pts = [Point(l[9], l[8]) for l in locs if l[0] == cd and l[8] not in (None, -1)]
        hits = Counter()
        for p in pts:
            for i in tree.query(p, predicate='within'): hits[codes[i]] += 1
        if hits:
            tse2geo[cd] = hits.most_common(1)[0][0]
            tse2ibge[cd] = c or tse2geo[cd]
            log['map_espacial'] += 1; print('  mapa espacial', uf, nm, '-> id', tse2ibge[cd], ibge_nome[tse2ibge[cd]], '| geometria', ibge_nome[tse2geo[cd]])
        else: print('  !! sem IBGE', uf, nm); log['sem_ibge'] += 1
    by_mun = defaultdict(list)
    for l in locs: by_mun[l[0]].append(l)
    groups = defaultdict(list)
    for cd in by_mun: groups[tse2geo.get(cd)].append(cd)
    out_locais, cells_feats, munis = [], [], []
    cell_count = 0
    for gcode, cds in groups.items():
        g = geoms.get(gcode)
        gbuf = g.buffer(0.004) if g is not None else None
        if gbuf is not None: shapely.prepare(gbuf)
        status = {}
        for cd in cds:
            ll = by_mun[cd]; cep_pts = defaultdict(list)
            for l in ll:
                lat, lon = l[8], l[9]
                if lat not in (None, -1) and lon not in (None, -1) and gbuf is not None and gbuf.contains(Point(lon, lat)):
                    status[l] = (lat, lon, 0)
                    if l[7]: cep_pts[l[7]].append((lat, lon)); cep_pts[l[7][:5]].append((lat, lon))
            for l in ll:
                if l in status: continue
                c = l[7] or ''
                cand = cep_pts.get(c) or cep_pts.get(c[:5])
                if cand:
                    status[l] = (float(np.mean([p[0] for p in cand])), float(np.mean([p[1] for p in cand])), 1); log['aprox_cep'] += 1
                else:
                    status[l] = (None, None, 2); log['sem_posicao'] += 1
        # agrupa por coordenada (mesmo prédio com vários números de local)
        pts = {}
        for cd in cds:
            for l in by_mun[cd]:
                lat, lon, fl = status[l]
                if lat is None: continue
                pts.setdefault((round(lon, 5), round(lat, 5)), []).append(l)
        keys = list(pts)
        cell_of = {}
        if g is not None and keys:
            if len(keys) == 1:
                polys = [g]
            else:
                mp = MultiPoint([Point(k) for k in keys])
                vor = shapely.voronoi_polygons(mp, extend_to=g.envelope.buffer(0.5), ordered=True)
                polys = list(shapely.intersection(np.array(vor.geoms), g))
            for k, poly in zip(keys, polys):
                if poly.is_empty: continue
                poly = poly.buffer(0) if not poly.is_valid else poly
                cid = cell_count; cell_count += 1
                # célula pertence ao município do local com mais eleitores no ponto
                cells_feats.append({'type': 'Feature', 'properties': {'c': cid, 'm': gcode}, 'geometry': mapping(poly)})
                for l in pts[k]: cell_of[l] = cid
        for cd in cds:
            ll = by_mun[cd]; ib = tse2ibge.get(cd)
            mi = len(munis)
            tot = {1: None, 2: None}; pp = {1: [0, 0, 0], 2: [0, 0, 0]}
            for l in ll:
                k = (uf, cd, l[2], l[3]); lat, lon, fl = status[l]
                rec = {'m': mi, 'z': l[2], 'n': l[3], 'nome': l[4], 'end': l[5], 'b': l[6], 'cep': l[7],
                       'c': cell_of.get(l, -1), 'f': fl,
                       'xy': [round(lon, 5), round(lat, 5)] if lat is not None else None}
                for t in (1, 2):
                    p = part.get((t,) + k)
                    rec[f'v{t}'] = votos[k][t]
                    rec[f'p{t}'] = list(p) if p else None
                    tot[t] = soma(tot[t], votos[k][t])
                    if p: pp[t] = [a + b for a, b in zip(pp[t], p)]
                out_locais.append(rec)
            munis.append({'ibge': ib, 'g': gcode, 'tse': cd, 'n': ibge_nome.get(ib, tse_mun[cd].title()), 'v1': tot[1], 'v2': tot[2], 'p1': pp[1], 'p2': pp[2]})
            if ib: brasil['munis'][ib] = {'n': munis[-1]['n'], 'uf': uf, 'g': gcode, 'v1': tot[1], 'v2': tot[2], 'p1': pp[1], 'p2': pp[2]}
    ut = {1: None, 2: None}; up = {1: [0, 0, 0], 2: [0, 0, 0]}
    for m in munis:
        for t in (1, 2):
            ut[t] = soma(ut[t], m[f'v{t}']); up[t] = [a + b for a, b in zip(up[t], m[f'p{t}'])]
    brasil['ufs'][uf] = {'v1': ut[1], 'v2': ut[2], 'p1': up[1], 'p2': up[2]}
    # compacta locais em arrays
    L = [[r['m'], r['z'], r['n'], r['nome'], r['end'], r['b'] or '', r['cep'] or '', r['c'], r['f'], r['xy'], r['v1'], r['p1'], r['v2'], r['p2']] for r in out_locais]
    json.dump({'uf': uf, 'munis': munis, 'locais': L, 'campos': ['muni', 'zona', 'nr_local', 'nome', 'endereco', 'bairro', 'cep', 'celula', 'flag_posicao', 'xy', 'votos_t1', 'part_t1[aptos,comparec,secoes]', 'votos_t2', 'part_t2']},
              open(f"{OUT}/dados_{uf}.json", 'w'), ensure_ascii=False, separators=(',', ':'))
    json.dump({'type': 'FeatureCollection', 'features': cells_feats}, open(f"{OUT}/cells_{uf}.geojson", 'w'))
    print(uf, 'munis', len(munis), 'locais', len(L), 'celulas', cell_count, flush=True)

json.dump(brasil, open(f"{OUT}/brasil_dados.json", 'w'), ensure_ascii=False, separators=(',', ':'))
print(dict(log))
