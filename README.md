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
- **Senhas** — lista simples de credenciais (sem criptografia — ver aviso abaixo)
- **Infra** — status ao vivo de serviços, tempo ligado e espaço em disco do host
- **Projetos** — quadro com status, prazo, notas e filtro, com arquivamento automático dos concluídos

Todos os dados ficam em arquivos JSON simples no disco, com backup automático a cada gravação (mantém as últimas 5 versões).

## Aviso de segurança

O cofre de senhas **não usa criptografia** — as senhas ficam em texto puro em `data/senhas.json`. Foi uma escolha consciente de simplicidade para uso pessoal em rede confiável (atrás de VPN/Tailscale, sem exposição à internet). Não use isso como um cofre de senhas de verdade se isso for uma preocupação para o seu caso de uso.

## Stack

- Backend: Python 3, só `http.server` da biblioteca padrão
- Frontend: HTML/CSS/JS puro, sem framework, sem build step
- Zero dependências externas
