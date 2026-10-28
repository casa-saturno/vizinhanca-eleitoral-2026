# Vizinhança Eleitoral 2026

Mapa de quem venceu a eleição presidencial de 2026 (1º e 2º turnos) em cada local de votação do Brasil.
Cada local recebe uma área de Voronoi recortada pela fronteira do município, como nos mapas de vizinhanças do Estadão.

- Site aberto: https://casa-saturno.github.io/vizinhanca-eleitoral-2026/
- Versão no claude.ai (privada até ser compartilhada): https://claude.ai/artifact/HtgTsGPYwT6xALtuZoxoCF

Dados: resultados por seção e eleitorado por local de votação do [TSE](https://dadosabertos.tse.jus.br/), malhas municipais do [IBGE](https://servicodados.ibge.gov.br/api/docs/malhas).

## Estrutura

- `pipeline/00_baixar.sh`: baixa os CSVs do TSE e as malhas do IBGE.
- `pipeline/01_agregar.py`: agrega votos, aptos e comparecimento por local, casando votos e coordenadas pela seção eleitoral (DuckDB).
- `pipeline/02_voronoi.py`: valida coordenadas, posiciona locais sem coordenada pelo CEP, calcula as áreas de Voronoi por município (Shapely) e gera os dados por UF.
- `pipeline/03_site.py`: monta `brasil.json`, `cep.json` e `dados_UF.json`.
- `src/`: HTML, CSS e JavaScript do mapa (MapLibre GL + topojson-client). `src/build.sh` gera as duas saídas abaixo.
- `site/`: site pronto para hospedagem estática. É o que o GitHub Pages publica, pelo workflow em `.github/workflows/pages.yml`.
- `artifact/index.html`: a mesma página em forma de fragmento, para publicar como Artifact no claude.ai junto com `site/data/`.

## Como regerar

```sh
python3 -m venv venv && ./venv/bin/pip install duckdb shapely numpy
npm i mapshaper@0.6.102
pipeline/00_baixar.sh dados
./venv/bin/python pipeline/01_agregar.py dados/tse/raw dados/eleicao.duckdb
./venv/bin/python pipeline/02_voronoi.py dados/eleicao.duckdb dados/ibge build/raw
for f in build/raw/cells_*.geojson; do uf=${f##*_}; uf=${uf%.geojson}; npx mapshaper -i "$f" -simplify interval=12 keep-shapes -rename-layers celulas -o site/data/celulas_$uf.json format=topojson quantization=300000; done
npx mapshaper -i dados/ibge/mun_*.geojson combine-files -merge-layers -each 'uf=codarea.slice(0,2)' -simplify 12% keep-shapes -rename-layers municipios -dissolve uf + name=estados -o site/data/brasil_mapa.json format=topojson quantization=100000 target=municipios,estados
python3 pipeline/03_site.py build/raw site/data
src/build.sh
```

Um push em `main` que mude `site/` publica a nova versão sozinho.

## Mapa de ruas e busca de endereço

Dentro do Artifact a página não pode acessar outros sites, então não há mapa de ruas nem busca de endereço livre.
Em hospedagem própria a página detecta isso e liga sozinha:

- o mapa de ruas do [OpenFreeMap](https://openfreemap.org) (dados do OpenStreetMap, sem chave), com ruas por baixo das áreas e nomes de ruas por cima;
- a busca de endereço pelo [Nominatim](https://nominatim.org), consultado só quando a pessoa escolhe “Procurar” na lista, como pede a política de uso do serviço.

Se o OpenFreeMap não responder em 5 segundos, o mapa abre sem ruas. Para testar o modo sem serviços externos, abra `index.html?offline`.
