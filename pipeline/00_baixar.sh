#!/bin/sh
# Baixa os arquivos do TSE e do IBGE usados pelo pipeline (cerca de 0,7 GB compactados).
set -e
D="${1:-./dados}"; mkdir -p "$D/tse/raw" "$D/ibge"
T=https://cdn.tse.jus.br/estatistica/sead/odsele
curl -sL -o "$D/tse/votacao_secao_2026_BR.zip" $T/votacao_secao/votacao_secao_2026_BR.zip
curl -sL -o "$D/tse/eleitorado_local_votacao_2026.zip" $T/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip
curl -sL -o "$D/tse/detalhe_votacao_secao_2026.zip" $T/detalhe_votacao_secao/detalhe_votacao_secao_2026.zip
unzip -o -q "$D/tse/votacao_secao_2026_BR.zip" -d "$D/tse/raw"
unzip -o -q "$D/tse/eleitorado_local_votacao_2026.zip" eleitorado_local_votacao_2026_BRASIL.csv -d "$D/tse/raw"
unzip -o -q "$D/tse/detalhe_votacao_secao_2026.zip" detalhe_votacao_secao_2026_BR.csv -d "$D/tse/raw"
curl -s "https://servicodados.ibge.gov.br/api/v1/localidades/municipios" -o "$D/ibge/municipios.json"
for uf in AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO; do
  curl -s "https://servicodados.ibge.gov.br/api/v3/malhas/estados/$uf?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio" -o "$D/ibge/mun_$uf.geojson"
  curl -s "https://servicodados.ibge.gov.br/api/v3/malhas/estados/$uf?formato=application/vnd.geo%2Bjson&qualidade=maxima&intrarregiao=municipio" -o "$D/ibge/max_$uf.geojson"
done
