#!/usr/bin/env python3
"""
Radar de Vagas — coleta vagas da Gupy, da InHire e da Sólides num banco SQLite.

    python3 radar.py

Roda na própria TV box. Só biblioteca padrão: nada de pip, nada de node_modules —
o aparelho tem ~1GB de RAM e 4GB de disco.

SEM FILTRO POR CARGO. Puxa tudo o que as duas plataformas deixam alcançar e guarda
em data/radar.db. Quem filtra é você, pela busca da intranet — e o filtro roda em
SQL, não no navegador, porque uma TV box não aguenta peneirar dezenas de milhares
de linhas em JavaScript.

Três limites vêm das APIs, não deste script:

  * Gupy: `offset + limit` precisa ser <= 10.000. Sem termo de busca, só dá para
    alcançar as 10.000 vagas MAIS RECENTES (das 84 mil publicadas). Como a API
    devolve em ordem de data, isso cobre os últimos dias — e é exatamente o que
    interessa em quem roda de 6 em 6 horas. Termos de busca em radar.config.json
    abrem uma janela de 10.000 adicional para cada termo, se quiser ir mais fundo.

  * Sólides: tem busca global (72 mil vagas), mas `take` acima de 12 volta vazio e
    a paginação repete itens entre páginas — a cobertura dela é estatística, não
    exaustiva. Ver o comentário em buscar_solides(). É a única que publica salário.

  * InHire: não tem busca global. Cada requisição é de UMA empresa (header
    X-Tenant), então a lista de data/inhire-tenants.json é o que torna a busca
    possível. Essa vem inteira: todas as ~8.700 vagas publicadas.

O banco acumula: a cada execução as vagas novas entram e as antigas ficam. Com o
tempo você tem um histórico que a API da Gupy não devolve, porque ela só deixa ver
as 10 mil mais recentes.
"""
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = DATA_DIR / "radar"
TENANTS_FILE = DATA_DIR / "inhire-tenants.json"
CONFIG_FILE = DATA_DIR / "radar.config.json"
DB_FILE = DATA_DIR / "radar.db"
DETAILS_FILE = CACHE_DIR / "inhire-details.json"
LOCK_FILE = CACHE_DIR / "radar.lock"

GUPY_API = "https://employability-portal.gupy.io/api/v1/jobs"
INHIRE_API = "https://api.inhire.app/job-posts/public/pages"
SOLIDES_API = "https://apigw.solides.com.br/jobs/v3/portal-vacancies-new"

# A API da InHire responde 403 para User-Agent de cliente HTTP padrão.
# Sem isto, TUDO volta vazio e sem erro aparente.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

GUPY_PAGE = 100
# Teto da API: offset + limit não pode passar disso. Não é escolha nossa.
GUPY_MAX_OFFSET = 10_000
# A Solides ignora take acima de 12 e devolve lista vazia. Também não é escolha nossa.
SOLIDES_PAGE = 12

DEFAULTS = {
    # Vazio = puxa a janela geral (as 10.000 mais recentes). Cada termo aqui abre
    # uma janela de 10.000 ADICIONAL, para alcançar vagas mais antigas de uma área.
    "queries": [],
    "esquecerAposDias": 120,
    # Páginas da Solides por execução (12 vagas cada). São 72 mil vagas no total e
    # a API só entrega 12 por vez — varrer tudo levaria ~3h. Como ela devolve em
    # ordem de data, 150 páginas (1.800 vagas) cobrem uns 3 dias de publicações,
    # folga confortável para quem roda de 6 em 6 horas. Aumente para fazer um
    # backfill histórico; o banco acumula o que já entrou.
    "maxPaginasSolides": 150,
    # A box tem 4 núcleos fracos. A rede é o gargalo, não o processador —
    # concorrência alta não acelera e só aumenta a chance de o Android matar tudo.
    "threads": 4,
    # Teto de buscas de data da InHire por execução, para nenhuma rodada ficar longa
    # o bastante para o Android matar o processo. O cache converge em algumas
    # execuções; para pular a espera, copie o cache pronto (veja o README).
    "maxDatasPorExecucao": 600,
}
THREADS = DEFAULTS["threads"]


def processo_vivo(pid):
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return False
    return True


def travar():
    """Impede duas coletas simultâneas.

    O agendador do server.py e o botão "Atualizar agora" já se coordenam entre si,
    mas nada impedia uma execução manual no terminal de colidir com a agendada. Duas
    coletas concorrentes gravam carimbos de tempo diferentes nas mesmas linhas, e o
    "no ar" sai errado — foi assim que este bug apareceu.

    Lock por PID, não por existência de arquivo: se o Android matar o processo, o
    arquivo fica para trás e travaria todas as execuções seguintes.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if LOCK_FILE.exists():
        try:
            pid = int(LOCK_FILE.read_text().strip())
        except ValueError:
            pid = None
        if pid and pid != os.getpid() and processo_vivo(pid):
            return False
    LOCK_FILE.write_text(str(os.getpid()))
    return True


def destravar():
    try:
        if LOCK_FILE.exists() and LOCK_FILE.read_text().strip() == str(os.getpid()):
            LOCK_FILE.unlink()
    except OSError:
        pass


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def http_json(url, headers=None, tentativas=2):
    """GET + JSON. Devolve None em vez de levantar: uma página que falha não pode
    derrubar a varredura inteira."""
    pedido = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": USER_AGENT, **(headers or {})
    })
    for tentativa in range(tentativas + 1):
        try:
            with urllib.request.urlopen(pedido, timeout=20) as resposta:
                return json.loads(resposta.read().decode("utf-8"))
        except urllib.error.HTTPError as erro:
            if erro.code < 500:
                return None  # 4xx é definitivo, não adianta insistir
        except Exception:
            pass
        if tentativa < tentativas:
            time.sleep(0.5 * (2 ** tentativa))
    return None


def ler_json(caminho, padrao):
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return padrao


def gravar_json_atomico(caminho, dados):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_suffix(caminho.suffix + ".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, caminho)


# ---------------------------------------------------------------- banco

ESQUEMA = """
CREATE TABLE IF NOT EXISTS vagas (
  link         TEXT PRIMARY KEY,
  titulo       TEXT NOT NULL,
  empresa      TEXT,
  plataforma   TEXT,
  local        TEXT,
  modalidade   TEXT,
  -- Só a Solides publica salário; nas outras fica vazio.
  salario      TEXT,
  publicada_em TEXT,
  vista_em     TEXT NOT NULL,
  -- Carimbo da coleta que viu esta vaga por último. "No ar" é derivado disto:
  -- coleta == meta.ultimaColetaOk. Ver o comentário em main().
  coleta       TEXT NOT NULL,
  busca        TEXT
);
CREATE INDEX IF NOT EXISTS idx_publicada ON vagas(publicada_em DESC);
CREATE INDEX IF NOT EXISTS idx_coleta ON vagas(coleta);
CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT);
"""


def abrir_banco():
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_FILE)
    # WAL deixa a intranet ler enquanto esta rotina escreve, sem travar a página.
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript(ESQUEMA)
    return con


def salvar(con, vagas, agora):
    """Grava as vagas e devolve quantas eram inéditas.

    O próprio banco é a memória do que já foi visto: vaga inédita é a que ainda não
    tem linha. Não existe arquivo de estado separado para dessincronizar.

    `vista_em` é preservado no conflito — é a data em que a vaga ENTROU no radar, e
    sobrescrevê-la faria tudo parecer novo a cada execução. Os demais campos são
    atualizados, porque o anúncio pode ter sido editado.
    """
    antes = con.execute("SELECT COUNT(*) FROM vagas").fetchone()[0]
    con.executemany(
        """
        INSERT INTO vagas (link, titulo, empresa, plataforma, local, modalidade,
                           salario, publicada_em, vista_em, coleta, busca)
        VALUES (:link, :titulo, :empresa, :plataforma, :local, :modalidade,
                :salario, :publicada_em, :vista_em, :vista_em, :busca)
        ON CONFLICT(link) DO UPDATE SET
          titulo=excluded.titulo, empresa=excluded.empresa, local=excluded.local,
          modalidade=excluded.modalidade, salario=excluded.salario,
          publicada_em=COALESCE(excluded.publicada_em, vagas.publicada_em),
          coleta=excluded.coleta
        """,
        [{**v, "vista_em": agora} for v in vagas],
    )
    con.commit()
    return con.execute("SELECT COUNT(*) FROM vagas").fetchone()[0] - antes


def podar(con, dias):
    """Remove vagas que sumiram das plataformas e já estão velhas. Vaga fora do ar
    continua listada por um tempo de propósito: some da API antes de você ter
    olhado, e você nem saberia que existiu."""
    corte = datetime.now(timezone.utc).timestamp() - dias * 86400
    corte_iso = datetime.fromtimestamp(corte, timezone.utc).isoformat()
    cur = con.execute("DELETE FROM vagas WHERE vista_em < ?", (corte_iso,))
    con.commit()
    return cur.rowcount


# ---------------------------------------------------------------- Gupy

def gupy_total(termo=None):
    """A API devolve `total` errado quando a página está cheia: com limit=100 ela
    ecoa 100 em vez do total real. Com limit=1 vem certo."""
    params = {"limit": 1, "offset": 0}
    if termo:
        params["jobName"] = termo
    dados = http_json(f"{GUPY_API}?{urllib.parse.urlencode(params)}")
    return (dados or {}).get("pagination", {}).get("total", 0)


def buscar_gupy(termo=None):
    """Puxa até onde a API deixa: offset + limit <= 10.000."""
    total = min(gupy_total(termo), GUPY_MAX_OFFSET)
    if total <= 0:
        return []

    pedidos = []
    for offset in range(0, total, GUPY_PAGE):
        limite = min(GUPY_PAGE, GUPY_MAX_OFFSET - offset)
        if limite > 0:
            pedidos.append((offset, limite))

    def pagina(par):
        offset, limite = par
        params = {"limit": limite, "offset": offset}
        if termo:
            params["jobName"] = termo
        return (http_json(f"{GUPY_API}?{urllib.parse.urlencode(params)}") or {}).get("data") or []

    with ThreadPoolExecutor(max_workers=THREADS) as executor:
        paginas = list(executor.map(pagina, pedidos))

    vagas = []
    for bruta in (item for pagina_ in paginas for item in pagina_):
        link = bruta.get("jobUrl") or bruta.get("careerPageUrl") or ""
        if not link:
            continue
        vagas.append({
            "link": link,
            "titulo": (bruta.get("name") or "").strip(),
            "empresa": (bruta.get("careerPageName") or bruta.get("companyName") or "").strip(),
            "plataforma": "Gupy",
            "local": " / ".join(x for x in [bruta.get("city"), bruta.get("state"), bruta.get("country")] if x),
            "modalidade": normalizar_modalidade(bruta.get("workplaceType")),
            "salario": "",
            "publicada_em": bruta.get("publishedDate"),
            "busca": termo or "",
        })
    return vagas


# ---------------------------------------------------------------- Solides

def slugificar(texto):
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", sem_acento.lower())).strip("-")


def link_solides(bruta):
    """O redirectLink que a API devolve está quebrado na prática — testado direto
    no navegador, os dois domínios que ela usa (`{empresa}.solides.jobs` e
    `{empresa}.vagas.solides.com.br`) não abrem, mesmo para slugs limpos.

    O que abre de verdade é o link SEM subdomínio de empresa que o próprio site
    da Sólides usa nos resultados de busca: vagas.solides.com.br/vaga/{id}/{slug}.
    Só funciona quando `id` é numérico — vagas nativas da plataforma. IDs
    alfanuméricos (tipo "mvgKhr7zoG") são de integrações externas via ATS e não
    têm página nesse domínio, e não existe link confiável pra elas — em vez de
    guardar com o redirectLink quebrado, a vaga nem entra no banco (ver
    buscar_solides: link vazio = descartada).
    """
    id_vaga = bruta.get("id")
    if isinstance(id_vaga, int) or (isinstance(id_vaga, str) and id_vaga.isdigit()):
        slug = slugificar(bruta.get("title") or "")
        return f"https://vagas.solides.com.br/vaga/{id_vaga}/{slug}"
    return ""


def buscar_solides(max_paginas):
    """Busca global de verdade — diferente da InHire, não precisa de lista de empresas.

    Três limites da API, todos medidos:

      * `take` acima de 12 devolve lista vazia. São ~6.000 requisições para as 72
        mil vagas, o que inviabiliza varrer tudo de uma vez.

      * `page` NÃO tem teto de profundidade (a Gupy trava em offset 10.000), então
        o histórico inteiro é alcançável — só não numa execução só.

      * A PAGINAÇÃO É INSTÁVEL. O mesmo id aparece nas páginas 1, 2, 3, 6 e 8: de
        360 itens buscados, 193 eram únicos. A ordenação é por data SEM hora, então
        vagas do mesmo dia empatam e o banco devolve em ordem arbitrária a cada
        consulta. Nenhum parâmetro de ordenação corrige (testados orderBy, sort,
        order, sortBy — todos com a mesma sobreposição de 8 em 12).

    Consequência prática: a cobertura da Solides é ESTATÍSTICA, não exaustiva. Cada
    execução amostra ~54% de itens novos e o banco acumula o resto ao longo das
    rodadas. Não dá para garantir "vi todas as vagas de hoje na Solides" — dá para
    garantir que, rodando de 6 em 6 horas, a cobertura cresce sozinha.
    """
    def pagina(p):
        dados = http_json(f"{SOLIDES_API}?take={SOLIDES_PAGE}&page={p}")
        return ((dados or {}).get("data") or {}).get("data") or []

    with ThreadPoolExecutor(max_workers=THREADS) as executor:
        paginas = list(executor.map(pagina, range(1, max_paginas + 1)))

    vagas = []
    for bruta in (item for pagina_ in paginas for item in pagina_):
        link = link_solides(bruta)
        if not link:
            continue
        cidade = (bruta.get("city") or {}).get("name") or ""
        estado = (bruta.get("state") or {}).get("code") or ""
        vagas.append({
            "link": link,
            "titulo": (bruta.get("title") or "").strip(),
            "empresa": (bruta.get("companyName") or "").strip(),
            "plataforma": "Solides",
            "local": " / ".join(x for x in [cidade, estado] if x),
            "modalidade": normalizar_modalidade(
                "remote" if bruta.get("homeOffice") else bruta.get("jobType")),
            "publicada_em": bruta.get("createdAt"),
            "salario": faixa_salarial(bruta.get("salary")),
            "busca": "",
        })
    return vagas


def faixa_salarial(salario):
    """Texto curto da faixa. A Solides é a única das três que publica salário."""
    if not isinstance(salario, dict) or salario.get("negotiable"):
        return ""
    ini, fim = salario.get("initialRange"), salario.get("finalRange")
    if not ini and not fim:
        return ""
    if ini and fim and ini != fim:
        return f"R$ {ini:,.0f} a {fim:,.0f}".replace(",", ".")
    return f"R$ {(ini or fim):,.0f}".replace(",", ".")


# ---------------------------------------------------------------- InHire

def inhire_indice():
    empresas = ler_json(TENANTS_FILE, [])
    if not empresas:
        log("AVISO: data/inhire-tenants.json ausente ou vazio — InHire será pulada.")
        return []

    def mural(empresa):
        dados = http_json(INHIRE_API, {"X-Inhire-Client": "web-inhire", "X-Tenant": empresa["slug"]})
        if not dados or not dados.get("tenantName"):
            return []
        nome = dados["tenantName"].strip() or empresa["name"]
        vagas = []
        for bruta in dados.get("jobsPage") or []:
            if str(bruta.get("status", "")).lower() != "published":
                continue
            job_id = bruta.get("jobId")
            titulo = (bruta.get("displayName") or "").strip()
            vagas.append({
                "link": f"https://{empresa['slug']}.inhire.app/vagas/{job_id}/{slug_titulo(titulo)}",
                "titulo": titulo,
                "empresa": nome,
                "plataforma": "InHire",
                "local": bruta.get("location") or "",
                "modalidade": normalizar_modalidade(bruta.get("workplaceType")),
                "salario": "",
                "publicada_em": None,
                "busca": "",
                "_jobId": job_id,
                "_tenant": empresa["slug"],
            })
        return vagas

    with ThreadPoolExecutor(max_workers=THREADS) as executor:
        murais = list(executor.map(mural, empresas))
    return [vaga for mural_ in murais for vaga in mural_]


def preencher_datas_inhire(vagas, teto_por_execucao):
    """A LISTAGEM da InHire não traz data, mas o DETALHE traz. É uma requisição por
    vaga, então vira cache permanente — data de publicação não muda."""
    cache = ler_json(DETAILS_FILE, {})
    faltando = [v for v in vagas if v.get("_jobId") and v["_jobId"] not in cache]
    pendentes = faltando[:teto_por_execucao]

    if pendentes:
        restante = len(faltando) - len(pendentes)
        log(f"InHire: buscando data de {len(pendentes)} vagas"
            + (f" (faltarão {restante} para as próximas execuções)" if restante else ""))

        def detalhe(vaga):
            dados = http_json(
                f"{INHIRE_API}/{vaga['_jobId']}",
                {"X-Inhire-Client": "web-inhire", "X-Tenant": vaga["_tenant"]},
                tentativas=1,
            )
            # Grava mesmo em falha, com data nula: sem isso a vaga é rebuscada em
            # toda execução e a rotina nunca converge.
            return vaga["_jobId"], (dados or {}).get("publishedAt")

        with ThreadPoolExecutor(max_workers=THREADS) as executor:
            for i, (job_id, publicada) in enumerate(executor.map(detalhe, pendentes), 1):
                cache[job_id] = publicada
                if i % 250 == 0:
                    log(f"  {i}/{len(pendentes)}")
        gravar_json_atomico(DETAILS_FILE, cache)

    for vaga in vagas:
        if vaga.get("_jobId"):
            vaga["publicada_em"] = cache.get(vaga["_jobId"])
        vaga.pop("_jobId", None)
        vaga.pop("_tenant", None)
    return vagas


# ---------------------------------------------------------------- utilidades

def normalizar_modalidade(valor):
    v = (valor or "").lower().strip()
    if "remot" in v:
        return "remote"
    if "hybrid" in v or "hibrid" in v:
        return "hybrid"
    if "on-site" in v or "onsite" in v or "presenc" in v:
        return "on-site"
    return ""


def sem_acento(texto):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")


def slug_titulo(titulo):
    import re
    return re.sub(r"[^a-z0-9]+", "-", sem_acento(titulo).lower()).strip("-") or "vaga"


# ---------------------------------------------------------------- principal

def main():
    global THREADS
    inicio = time.time()
    config = {**DEFAULTS, **ler_json(CONFIG_FILE, {})}
    THREADS = max(1, int(config["threads"]))
    agora = datetime.now(timezone.utc).isoformat()

    if not travar():
        log("Outra coleta já está em andamento. Saindo.")
        return

    con = abrir_banco()
    total_novas = 0

    log("Gupy: puxando a janela mais recente (teto de 10.000 da API)...")
    vagas = buscar_gupy()
    total_novas += salvar(con, vagas, agora)
    log(f"Gupy: {len(vagas)} vagas.")

    for termo in config["queries"]:
        extra = buscar_gupy(termo)
        total_novas += salvar(con, extra, agora)
        log(f"Gupy '{termo}': +{len(extra)} vagas.")

    paginas_solides = int(config["maxPaginasSolides"])
    if paginas_solides > 0:
        log(f"Solides: puxando as {paginas_solides} páginas mais recentes...")
        solides = buscar_solides(paginas_solides)
        total_novas += salvar(con, solides, agora)
        log(f"Solides: {len(solides)} vagas.")

    log("InHire: montando índice de todas as empresas...")
    inhire = preencher_datas_inhire(inhire_indice(), int(config["maxDatasPorExecucao"]))
    total_novas += salvar(con, inhire, agora)
    log(f"InHire: {len(inhire)} vagas.")

    removidas = podar(con, int(config["esquecerAposDias"]))

    # SÓ AGORA, com a coleta inteira concluída, este carimbo passa a valer como
    # "o que está no ar". A versão anterior marcava tudo como inativo no início e
    # torcia para reativar durante a varredura — o que deixava o banco inteiro fora
    # do ar durante os ~5 minutos da coleta, e permanentemente se o Android matasse
    # o processo no meio. Num aparelho que mata processos, isso não é hipótese.
    con.execute(
        "INSERT INTO meta (chave, valor) VALUES ('ultimaColetaOk', ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor", (agora,))
    con.execute(
        "INSERT INTO meta (chave, valor) VALUES ('geradoEm', ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor", (agora,))
    con.execute(
        "INSERT INTO meta (chave, valor) VALUES ('novasUltimaExecucao', ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor", (str(total_novas),))
    con.commit()

    no_banco = con.execute("SELECT COUNT(*) FROM vagas").fetchone()[0]
    ativas = con.execute("SELECT COUNT(*) FROM vagas WHERE coleta=?", (agora,)).fetchone()[0]
    con.execute("VACUUM")
    con.close()

    tamanho = DB_FILE.stat().st_size / 1048576
    log(f"Banco: {no_banco} vagas ({ativas} no ar) · {total_novas} novas · "
        f"{removidas} removidas · {tamanho:.1f} MB · {time.time() - inicio:.0f}s")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    finally:
        destravar()
