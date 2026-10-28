# Monta os arquivos finais do site: brasil.json, cep.json e dados_UF.json
import json, glob, os, sys
from collections import defaultdict, Counter
RAW, OUT = sys.argv[1], sys.argv[2]
NOMES = {'2405306': 'Boa Saúde'}  # renomeado (ex-Januário Cicco); IBGE ainda usa o nome antigo
b = json.load(open(f'{RAW}/brasil_dados.json'))
for k, n in NOMES.items():
    if k in b['munis']: b['munis'][k]['n'] = n
cep = defaultdict(lambda: defaultdict(list))
nloc = Counter()
for f in sorted(glob.glob(f'{RAW}/dados_*.json')):
    d = json.load(open(f)); uf = d['uf']
    for m in d['munis']:
        if m['ibge'] in NOMES: m['n'] = NOMES[m['ibge']]
    for l in d['locais']:
        m = d['munis'][l[0]]
        nloc[m['ibge']] += 1
        if l[8] == 0 and l[6] and len(l[6]) == 8:
            cep[l[6][:5]][m['ibge']].append(l[9])
    del d['campos']
    json.dump(d, open(f'{OUT}/dados_{uf}.json', 'w'), ensure_ascii=False, separators=(',', ':'))
for k, m in b['munis'].items(): m['nl'] = nloc[k]
b['gerado'] = {'votacao_secao': '26/10/2026', 'detalhe_votacao_secao': '26/10/2026', 'eleitorado_local_votacao': '25/10/2026'}
json.dump(b, open(f'{OUT}/brasil.json', 'w'), ensure_ascii=False, separators=(',', ':'))
C = {}
for c5, bym in cep.items():
    ib, pts = max(bym.items(), key=lambda kv: len(kv[1]))
    C[c5] = [round(sum(p[0] for p in pts) / len(pts), 4), round(sum(p[1] for p in pts) / len(pts), 4), ib]
json.dump(C, open(f'{OUT}/cep.json', 'w'), separators=(',', ':'))
print('ceps', len(C), 'munis', len(b['munis']))
