#!/usr/bin/env python3
"""Servidor local"""
import http.cookiejar
import json
import shutil
import socket
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"
BACKUP_DIR = DATA_DIR / "backups"
BACKUP_DIR.mkdir(exist_ok=True)
BACKUP_INTERVALO_MIN = 15 * 60
BACKUP_MANTER = 5
PORT = 8080

CONFIG = json.loads((DATA_DIR / "config.json").read_text(encoding="utf-8"))

CAMPOS_PROJETO = ("nome", "grupo", "status", "prazo", "descricao", "link", "notas")


def ler_json(nome):
    return json.loads((DATA_DIR / nome).read_text(encoding="utf-8"))


def _backup_se_necessario(caminho):
    existentes = sorted(BACKUP_DIR.glob(f"{caminho.stem}_*{caminho.suffix}"))
    if existentes and time.time() - existentes[-1].stat().st_mtime < BACKUP_INTERVALO_MIN:
        return
    marca = datetime.now().strftime("%Y%m%d_%H%M%S")
    (BACKUP_DIR / f"{caminho.stem}_{marca}{caminho.suffix}").write_bytes(caminho.read_bytes())
    todos = sorted(BACKUP_DIR.glob(f"{caminho.stem}_*{caminho.suffix}"))
    for velho in todos[:-BACKUP_MANTER]:
        velho.unlink()


def gravar_json(nome, dados):
    caminho = DATA_DIR / nome
    if caminho.exists():
        _backup_se_necessario(caminho)
    tmp = caminho.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(caminho)


def com_timestamps(projetos_novos):
    """criado_em/modificado_em com o que já está salvo."""
    antigos = {p["id"]: p for p in ler_json("projetos.json")}
    agora = datetime.now().isoformat(timespec="seconds")
    for p in projetos_novos:
        anterior = antigos.get(p.get("id"))
        if anterior is None:
            p["criado_em"] = agora
            p["modificado_em"] = agora
        else:
            p["criado_em"] = anterior.get("criado_em", agora)
            mudou = any(p.get(c) != anterior.get(c) for c in CAMPOS_PROJETO)
            p["modificado_em"] = agora if mudou else anterior.get("modificado_em", agora)
    return projetos_novos


def checar_adguard():
    url = CONFIG.get("adguard_url", "").strip()
    if not url:
        return {"status": "not_configured", "detalhe": "Ainda não configurado"}
    base = url.rstrip("/")
    usuario = CONFIG.get("adguard_user", "")
    senha = CONFIG.get("adguard_pass", "")
    try:
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        if usuario and senha:
            login_body = json.dumps({"name": usuario, "password": senha}).encode("utf-8")
            login_req = urllib.request.Request(
                base + "/control/login", data=login_body,
                headers={"Content-Type": "application/json"},
            )
            opener.open(login_req, timeout=1.5)
        req = urllib.request.Request(base + "/control/status")
        with opener.open(req, timeout=1.5) as resp:
            dados = json.loads(resp.read().decode("utf-8"))
            protegido = "ativo" if dados.get("protection_enabled") else "sem proteção"
            return {"status": "online", "detalhe": f"Online — {protegido}"}
    except Exception:
        return {"status": "offline", "detalhe": "Sem resposta"}


def checar_tailscale():
    host = CONFIG.get("tailscale_check_host", "").strip()
    if not host:
        return {"status": "not_configured", "detalhe": "Ainda não configurado"}
    try:
        resultado = subprocess.run(
            ["ping", "-c", "1", "-W", "1", host],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3
        )
        if resultado.returncode == 0:
            return {"status": "online", "detalhe": f"Respondendo em {host}"}
        return {"status": "offline", "detalhe": "Sem resposta"}
    except Exception:
        return {"status": "offline", "detalhe": "Falha ao checar"}


def sheets_ler(script_url, token, aba, linha_cabecalho=1):
    if not script_url:
        return {"erro": "planilha ainda não configurada"}
    qs = urllib.parse.urlencode({"token": token, "aba": aba, "linhaCabecalho": linha_cabecalho})
    try:
        with urllib.request.urlopen(f"{script_url}?{qs}", timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"erro": str(e)}


def sheets_opcoes_coluna(script_url, token, aba, coluna, linha_cabecalho=1):
    if not script_url:
        return {"erro": "planilha ainda não configurada"}
    qs = urllib.parse.urlencode({
        "token": token, "aba": aba, "opcoesColuna": coluna, "linhaCabecalho": linha_cabecalho,
    })
    try:
        with urllib.request.urlopen(f"{script_url}?{qs}", timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"erro": str(e)}


def sheets_escrever(script_url, token, aba, action, dados, linha=None, linha_cabecalho=1):
    if not script_url:
        return {"erro": "planilha ainda não configurada"}
    payload = {"token": token, "aba": aba, "action": action, "dados": dados, "linhaCabecalho": linha_cabecalho}
    if linha is not None:
        payload["_linha"] = linha
    body = json.dumps(payload).encode("utf-8")
    # O Apps Script processa o POST na 1a resposta e redireciona (302) pra
    # servir o resultado pronto — esse redirecionamento precisa ser um GET
    # (comportamento padrão do urllib), não um POST de novo.
    req = urllib.request.Request(
        script_url, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"erro": str(e)}


def checar_sistema():
    try:
        with open("/proc/uptime") as f:
            segundos = float(f.read().split()[0])
        dias, resto = divmod(int(segundos), 86400)
        horas, resto = divmod(resto, 3600)
        minutos = resto // 60
        uptime_str = f"{dias}d {horas}h {minutos}m" if dias else f"{horas}h {minutos}m"
    except Exception:
        uptime_str = "desconhecido"
    try:
        uso = shutil.disk_usage(str(DATA_DIR))
        disco_str = f"{uso.free / 1024**3:.1f}GB livres de {uso.total / 1024**3:.1f}GB"
    except Exception:
        disco_str = "desconhecido"
    return {"uptime": uptime_str, "disco": disco_str}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _enviar_json(self, dados, status=200):
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _servir_arquivo(self, caminho, tipo):
        try:
            corpo = caminho.read_bytes()
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self._servir_arquivo(BASE_DIR / "index.html", "text/html; charset=utf-8")
        elif self.path == "/static/style.css":
            self._servir_arquivo(STATIC_DIR / "style.css", "text/css; charset=utf-8")
        elif self.path == "/static/script.js":
            self._servir_arquivo(STATIC_DIR / "script.js", "application/javascript; charset=utf-8")
        elif self.path == "/api/projetos":
            self._enviar_json(ler_json("projetos.json"))
        elif self.path == "/api/atalhos":
            self._enviar_json(ler_json("atalhos.json"))
        elif self.path == "/api/senhas":
            self._enviar_json(ler_json("senhas.json"))
        elif self.path == "/api/prospeccao":
            self._enviar_json(ler_json("prospeccao.json"))
        elif self.path == "/api/financas":
            self._enviar_json(sheets_ler(
                CONFIG.get("financas_script_url", ""), CONFIG.get("sheets_token", ""),
                CONFIG.get("financas_aba", "Lancamentos"),
                CONFIG.get("financas_linha_cabecalho", 1),
            ))
        elif self.path == "/api/vagas":
            self._enviar_json(sheets_ler(
                CONFIG.get("vagas_script_url", ""), CONFIG.get("sheets_token", ""),
                CONFIG.get("vagas_aba", "Vagas"),
            ))
        elif self.path == "/api/vagas/status-opcoes":
            self._enviar_json(sheets_opcoes_coluna(
                CONFIG.get("vagas_script_url", ""), CONFIG.get("sheets_token", ""),
                CONFIG.get("vagas_aba", "Vagas"), "Status",
            ))
        elif self.path == "/api/infra":
            self._enviar_json({
                "adguard": checar_adguard(),
                "tailscale": checar_tailscale(),
                "sistema": checar_sistema(),
            })
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        tamanho = int(self.headers.get("Content-Length", 0))
        if tamanho > 2_000_000:
            self.send_response(413)
            self.end_headers()
            return
        corpo = self.rfile.read(tamanho)
        try:
            dados = json.loads(corpo.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return

        if self.path == "/api/projetos" and isinstance(dados, list):
            dados = com_timestamps(dados)
            gravar_json("projetos.json", dados)
            self._enviar_json(dados)
        elif self.path == "/api/atalhos" and isinstance(dados, list):
            gravar_json("atalhos.json", dados)
            self._enviar_json({"ok": True})
        elif self.path == "/api/senhas" and isinstance(dados, list):
            gravar_json("senhas.json", dados)
            self._enviar_json({"ok": True})
        elif self.path == "/api/prospeccao" and isinstance(dados, list):
            gravar_json("prospeccao.json", dados)
            self._enviar_json({"ok": True})
        elif self.path == "/api/financas" and isinstance(dados, dict):
            self._enviar_json(sheets_escrever(
                CONFIG.get("financas_script_url", ""), CONFIG.get("sheets_token", ""),
                CONFIG.get("financas_aba", "Lancamentos"),
                dados.get("action"), dados.get("dados", {}), dados.get("_linha"),
                CONFIG.get("financas_linha_cabecalho", 1),
            ))
        elif self.path == "/api/vagas" and isinstance(dados, dict):
            self._enviar_json(sheets_escrever(
                CONFIG.get("vagas_script_url", ""), CONFIG.get("sheets_token", ""),
                CONFIG.get("vagas_aba", "Vagas"),
                dados.get("action"), dados.get("dados", {}), dados.get("_linha"),
            ))
        else:
            self.send_response(400)
            self.end_headers()


if __name__ == "__main__":
    servidor = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    ip_local = socket.gethostbyname(socket.gethostname())
    print(f"Intranet rodando em:")
    print(f"  http://localhost:{PORT}")
    print(f"  http://{ip_local}:{PORT}  (outros dispositivos da rede)")
    servidor.serve_forever()
