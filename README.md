# TVBOX Intranet

Como uma TV box Android genérica (Allwinner H616, 4 núcleos, RAM e armazenamento bem limitados) parada numa gaveta virou um servidor doméstico rodando bloqueio de anúncios, VPN pessoal e um dashboard de intranet — tudo sem gastar nada além do tempo.

## Contexto

O hardware é bem modesto: SoC de baixo custo, ~1GB de RAM, 4GB de armazenamento, Android customizado (fabricante genérico). Nada nele foi trocado ou "hackeado" no sentido de flashar outra ROM — tudo roda em cima do Android original, usando o [Termux](https://termux.dev) como ambiente Linux dentro do próprio sistema, com autostart via Termux:Boot.

## O que está rodando

- **[AdGuard Home](https://adguard.com/en/adguard-home/overview.html)** — servidor DNS que filtra anúncios e rastreadores para os dispositivos que o usam, rodando como root para poder escutar na porta 53
- **[Tailscale](https://tailscale.com)** — VPN mesh pessoal, usada tanto para acesso remoto ao dispositivo quanto para contornar limitações da rede local (o roteador da operadora bloqueia comunicação direta entre dispositivos na LAN — o Tailscale resolve isso saindo pela internet e voltando)
- **Intranet** (pasta [`intranet/`](./intranet)) — dashboard pessoal com atalhos, cofre de senhas simples, status ao vivo da infraestrutura e um quadro de projetos. É o único componente com código próprio; os outros dois são configuração de software de terceiros.
- **Autostart** ([`scripts/start-sshd.sh`](./scripts/start-sshd.sh)) — script disparado pelo Termux:Boot a cada reinicialização, subindo AdGuard Home, o servidor da intranet e um SSH server (usado para administração remota, já que a Play Store filtra apps de terminal em dispositivos com perfil Android TV).

## Desafios reais do hardware

Alguns problemas específicos desse tipo de dispositivo, caso alguém esteja tentando algo parecido:

- **ABI 32-bit apesar do chip ser 64-bit** — o Android instalado só suporta `armeabi-v7a`/`armeabi`, então versões recentes do Termux (que abandonaram 32-bit) não instalam. Solução: usar uma release mais antiga que ainda publica build de 32-bit.
- **Processos em segundo plano morrem sozinhos** — com pouca RAM livre, o Android mata processos "órfãos" sem aviso. A correção foi rodar o processo principal do script de boot em modo *foreground* (`sshd -D` em vez de `sshd`), o que o mantém protegido.
- **Sem certificados CA acessíveis fora do Termux** — binários Go (como o AdGuard Home) rodando fora do sandbox do Termux não enxergam o cadeia de certificados do sistema, quebrando qualquer chamada HTTPS. Solução: reaproveitar o bundle de certificados que o próprio Termux já traz (`SSL_CERT_FILE`).
- **Disparo de boot inconsistente** — o `Termux:Boot` não dispara em 100% dos reboots nessa firmware específica (falha de entrega de broadcast do próprio Android, não do script). Aceito como limitação conhecida.

## Rodando a intranet localmente

```bash
cd intranet/data
cp config.example.json config.json
cp projetos.example.json projetos.json
cp atalhos.example.json atalhos.json
cp senhas.example.json senhas.json
cd ..
python3 server.py
```

Edite `data/config.json` com a URL/credenciais do seu AdGuard Home (se tiver um) e o host de checagem do Tailscale.

Acesse em `http://localhost:8080`.

## O que tem na intranet

- **Atalhos** — grade de links rápidos, com editar/mover/excluir
- **Senhas** — lista simples de credenciais
- **Infra** — status ao vivo de serviços, tempo ligado e espaço em disco do host
- **Projetos** — quadro com status, prazo, notas e filtro, com arquivamento automático dos concluídos
- **Radar de Vagas** — coleta vagas da Gupy, InHire, Sólides e InfoJobs e lista por data de publicação

Todos os dados ficam em arquivos JSON simples no disco, com backup automático a cada gravação (mantém as últimas 5 versões).

## Radar de Vagas

Coleta vagas da **Gupy**, da **InHire**, da **Sólides** e do **InfoJobs** e guarda
num SQLite, para você buscar e decidir. Roda na própria box, em
[`intranet/radar.py`](./intranet/radar.py) — só biblioteca padrão, nada de pip, nada
de `node_modules`.

```bash
cd intranet
cp data/radar.config.example.json data/radar.config.json
python3 radar.py
```

O `server.py` dispara sozinho a cada 6h (`radar_intervalo_horas` no `config.json`;
`0` desliga) e a aba tem botão "Atualizar agora". Roda como **subprocesso**: se
travar ou estourar memória, a intranet continua de pé.

Não há cron aqui de propósito — o Termux não traz um, e o Android mata processos
soltos em segundo plano (mesmo motivo pelo qual o `sshd` roda em foreground). O
servidor já é um processo vivo e protegido, então é ele quem agenda.

### Sem filtro por cargo

A coleta puxa **tudo** o que as APIs deixam alcançar; quem filtra é você, pela busca
da aba. Foram 20.108 vagas em duas coletas, de atendente de restaurante a enfermeiro
a desenvolvedor.

O filtro roda em **SQL, não em JavaScript**. Mandar 20 mil linhas para o navegador
de uma TV box peneirar em memória travaria a página; o SQLite responde em ~20ms e o
browser nunca recebe mais que 50 linhas.

### Quatro limites que vêm das origens, não do script

**Gupy:** `offset + limit` precisa ser ≤ 10.000. Sem termo de busca dá para alcançar
só as **10.000 mais recentes** das 84 mil publicadas. Como a API devolve em ordem de
data, isso cobre os últimos dias — que é o que interessa em quem roda de 6 em 6h.
Termos em `radar.config.json` abrem uma janela de 10.000 adicional cada, para ir mais
fundo numa área específica.

**Sólides:** tem busca global de verdade (72 mil vagas, sem autenticação) e, ao
contrário da Gupy, **sem teto de profundidade** — o histórico inteiro é alcançável.
Em compensação `take` acima de 12 devolve lista vazia, então varrer tudo seria ~6.000
requisições, ou 3 horas. A coleta pega as 150 páginas mais recentes por rodada.

E há um defeito na paginação deles: **o mesmo id aparece em páginas diferentes**
(1, 2, 3, 6 e 8 no teste) — de 360 itens buscados, 193 eram únicos. Eles ordenam por
data sem hora, então vagas do mesmo dia empatam e voltam em ordem arbitrária a cada
consulta; nenhum parâmetro de ordenação corrige. Isso torna a cobertura da Sólides
**estatística, não exaustiva**: cada rodada amostra e o banco acumula o resto. Medido:
as mesmas 150 páginas renderam 891 vagas na primeira coleta e +252 inéditas na
segunda. É a única plataforma das três onde não dá para afirmar "vi tudo o que saiu
hoje".

Em troca, é a única que publica **salário** — aparece no card quando existe.

**InHire:** não tem busca global. Cada requisição é de uma empresa (header
`X-Tenant`), então [`data/inhire-tenants.json`](./intranet/data/inhire-tenants.json)
é o que torna a busca possível. As 448 empresas foram enumeradas de fontes públicas
(Wayback CDX e urlscan.io sobre `*.inhire.app`) e validadas uma a uma. Essa vem
inteira: todas as ~8.700 vagas publicadas.

> A API da InHire responde **403** para User-Agent de cliente HTTP padrão. Sem um UA
> de navegador, tudo volta vazio e sem erro aparente.

**InfoJobs:** não tem API pública — as vagas vêm embutidas no HTML da página, então
a coleta é *scraping* (regex sobre o HTML), não leitura de JSON como as outras três.
Isso é estruturalmente mais frágil: se o InfoJobs mudar o layout do site, a coleta
quebra sem aviso, ao contrário de uma API versionada.

Também não tem busca nacional — toda URL redireciona por geolocalização do IP pra
uma cidade (`empregos-em-{cidade}.aspx` sem UF sempre volta pra São Paulo, não
importa a cidade pedida). Só fica na cidade certa com o UF explícito no slug
(`empregos-em-belo-horizonte,-mg.aspx`). Sem lista fechada de "tenants" como a
InHire — são milhares de municípios —, a cobertura fica restrita às principais
capitais (`INFOJOBS_CIDADES` em `radar.py`), por escolha, não por limite técnico.
Ajuste essa lista para priorizar outra região.

### O banco vira o arquivo que a API não te dá

Cada coleta acrescenta; nada é apagado enquanto não envelhece. Como a Gupy só deixa
ver as 10 mil mais recentes, depois de algumas semanas o seu banco tem um histórico
que a própria plataforma não devolve.

Vaga que sai do ar continua listada por um tempo, marcada como **"saiu do ar"** — se
sumisse na hora, ela poderia desaparecer antes de você ter olhado e você nem saberia
que existiu. O filtro "Só as no ar" vem ligado.

### A primeira carga de datas é a demorada

A listagem da InHire não traz data de publicação; o endpoint de detalhe traz. É uma
requisição por vaga — cerca de 8.700 —, então o script busca no máximo 600 por
execução e o cache converge em algumas rodadas. Para pular a espera, copie o cache
pronto de uma máquina mais rápida:

```bash
scp inhire-details.json tvbox:~/tvbox-intranet/intranet/data/radar/
```

Isso importa: a mediana de idade das vagas da InHire é de **58 dias**, e há anúncios
de mais de três anos ainda marcados como publicados. Por isso a idade aparece
colorida em cada card — e por isso não existe nota de adequação: ler título e data
leva dois segundos e não erra como um score erraria.

### Custo na box

Medido: **55 MB de pico de RAM**, poucos segundos de CPU por rodada (o resto é espera
de rede), **10 MB** de banco para 20.108 vagas (antes do InfoJobs). A coleta das
quatro plataformas leva alguns minutos numa máquina de mesa; na box, espere mais.

## Aviso de segurança

O cofre de senhas **não usa criptografia** — as senhas ficam em texto puro em `data/senhas.json`. Foi uma escolha consciente de simplicidade para uso pessoal em rede confiável (atrás de VPN/Tailscale, sem exposição à internet). Não use isso como um cofre de senhas de verdade se isso for uma preocupação para o seu caso de uso.

## Stack

- Backend: Python 3, só `http.server` da biblioteca padrão
- Frontend: HTML/CSS/JS puro, sem framework, sem build step
- Zero dependências externas
