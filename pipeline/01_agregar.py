# Agrega os CSVs do TSE por local de votação, casando votos e coordenadas pela seção.
import duckdb, sys
RAW = sys.argv[1]; DB = sys.argv[2]
con = duckdb.connect(DB)
opt = "delim=';', header=true, encoding='latin-1', all_varchar=true"
I = lambda c: f"CAST({c} AS INT)"
con.execute(f"""
CREATE OR REPLACE TABLE votos_secao AS
SELECT {I('NR_TURNO')} turno, SG_UF uf, {I('CD_MUNICIPIO')} cd_mun, any_value(NM_MUNICIPIO) nm_mun,
       {I('NR_ZONA')} zona, {I('NR_SECAO')} secao, any_value({I('NR_LOCAL_VOTACAO')}) nr_local_v,
       any_value(NM_LOCAL_VOTACAO) nome_v, any_value(DS_LOCAL_VOTACAO_ENDERECO) end_v,
       {I('NR_VOTAVEL')} nr, any_value(NM_VOTAVEL) nm, SUM(CAST(QT_VOTOS AS BIGINT)) votos
FROM read_csv('{RAW}/votacao_secao_2026_BR.csv', {opt})
WHERE CD_CARGO='1' GROUP BY turno, uf, cd_mun, zona, secao, nr""")
con.execute(f"""
CREATE OR REPLACE TABLE det_secao AS
SELECT {I('NR_TURNO')} turno, SG_UF uf, {I('CD_MUNICIPIO')} cd_mun, {I('NR_ZONA')} zona, {I('NR_SECAO')} secao,
       {I('NR_LOCAL_VOTACAO')} nr_local_v, NM_LOCAL_VOTACAO nome_v, DS_LOCAL_VOTACAO_ENDERECO end_v, NM_MUNICIPIO nm_mun,
       CAST(QT_APTOS AS BIGINT) aptos, CAST(QT_COMPARECIMENTO AS BIGINT) comparec
FROM read_csv('{RAW}/detalhe_votacao_secao_2026_BR.csv', {opt})
WHERE CD_CARGO='1'""")
con.execute(f"""
CREATE OR REPLACE TABLE secao_local AS
SELECT {I('NR_TURNO')} turno, SG_UF uf, {I('CD_MUNICIPIO')} cd_mun, {I('NR_ZONA')} zona, {I('NR_SECAO')} secao,
       {I('NR_LOCAL_VOTACAO')} nr_local, NM_LOCAL_VOTACAO nome, DS_ENDERECO endereco, NM_BAIRRO bairro, NR_CEP cep,
       TRY_CAST(replace(NR_LATITUDE, ',', '.') AS DOUBLE) lat, TRY_CAST(replace(NR_LONGITUDE, ',', '.') AS DOUBLE) lon,
       DS_TIPO_SECAO_AGREGADA tipo_secao
FROM read_csv('{RAW}/eleitorado_local_votacao_2026_BRASIL.csv', {opt})""")
# chave do local: usa o cadastro (por seção); se não achar, usa o número do arquivo de votos
con.execute("""
CREATE OR REPLACE TABLE sec AS
SELECT d.turno, d.uf, d.cd_mun, d.nm_mun, d.zona, d.secao, d.aptos, d.comparec,
       coalesce(s.nr_local, d.nr_local_v) nr_local, s.nr_local IS NOT NULL casou,
       coalesce(s.nome, d.nome_v) nome, coalesce(s.endereco, d.end_v) endereco, s.bairro, s.cep, s.lat, s.lon
FROM det_secao d LEFT JOIN secao_local s USING (turno, uf, cd_mun, zona, secao)""")
con.execute("""
CREATE OR REPLACE TABLE votos_local AS
SELECT v.turno, v.uf, v.cd_mun, coalesce(s.nr_local, v.nr_local_v) nr_local, v.zona, v.nr, any_value(v.nm) nm, SUM(v.votos) votos
FROM votos_secao v LEFT JOIN secao_local s USING (turno, uf, cd_mun, zona, secao)
GROUP BY ALL""")
con.execute("""
CREATE OR REPLACE TABLE local_turno AS
SELECT turno, uf, cd_mun, any_value(nm_mun) nm_mun, zona, nr_local, SUM(aptos) aptos, SUM(comparec) comparec,
       COUNT(*) secoes, bool_and(casou) casou
FROM sec GROUP BY turno, uf, cd_mun, zona, nr_local""")
con.execute("""
CREATE OR REPLACE TABLE locais AS
SELECT uf, cd_mun, zona, nr_local, arg_max(nm_mun, turno) nm_mun,
  arg_max(nome, turno) nome, arg_max(endereco, turno) endereco, arg_max(bairro, turno) bairro,
  arg_max(cep, turno) cep, arg_max(lat, turno) lat, arg_max(lon, turno) lon
FROM sec GROUP BY uf, cd_mun, zona, nr_local""")
for t in ['votos_secao','det_secao','secao_local','sec','votos_local','local_turno','locais']:
    print(t, con.execute(f"select count(*) from {t}").fetchone())
print('secoes sem cadastro', con.execute("select turno, count(*) filter (where not casou), sum(comparec) filter (where not casou) from sec where uf<>'ZZ' group by 1").fetchall())
print('locais sem coord', con.execute("select count(*) filter (where lat is null or lat=-1) from locais where uf<>'ZZ'").fetchall())
print(con.execute("select turno, sum(votos) from votos_local group by 1 order by 1").fetchall())
