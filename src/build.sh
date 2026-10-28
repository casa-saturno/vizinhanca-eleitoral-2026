#!/bin/sh
# Monta as duas saídas a partir de src/:
#   site/index.html      documento completo, para hospedagem estática (GitHub Pages)
#   artifact/index.html  fragmento para publicar como Artifact no claude.ai (usa os mesmos data/)
S="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$S/artifact"
python3 -I - "$S" <<'PY'
import sys
S = sys.argv[1]
head = open(f'{S}/src/head.html').read().replace('/*__MAPLIBRE_CSS__*/', open(f'{S}/src/maplibre.css').read())
body = open(f'{S}/src/body.html').read()
js = open(f'{S}/src/app.js').read()
libs = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js"></script>\n'
        '<script src="https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js"></script>\n')
og = ('<meta property="og:title" content="Vizinhança Eleitoral 2026">\n'
      '<meta property="og:description" content="Quem venceu a eleição presidencial de 2026 em cada local de votação do Brasil, com dados do TSE.">\n'
      '<meta property="og:type" content="website">\n'
      '<meta name="theme-color" content="#14181d">\n')
open(f'{S}/artifact/index.html', 'w').write(head + '\n' + body + '\n' + libs + '<script>\n' + js + '\n</script>\n')
open(f'{S}/site/index.html', 'w').write(
    '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    + og + head + '\n</head>\n<body>\n' + body + '\n' + libs + '<script>\n' + js + '\n</script>\n</body>\n</html>\n')
print('ok')
PY
