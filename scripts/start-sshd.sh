#!/data/data/com.termux/files/usr/bin/sh
# Disparado pelo Termux:Boot a cada boot do Android.
# Roda como executável dentro de ~/.termux/boot/ no Termux.
export PATH=/data/data/com.termux/files/usr/bin:$PATH
termux-wake-lock

# Esse hardware não tem RTC com bateria: o relógio reseta pra uma data
# fixa a cada boot, quebrando validação de certificado TLS (Tailscale,
# downloads HTTPS do AdGuard Home etc). A sincronização automática do
# Android não corrige a tempo nessa firmware, então corrigimos aqui via
# cabeçalho HTTP (não depende de HTTPS/certificado, então funciona mesmo
# com o relógio errado).
DH=$(curl -s -D - -o /dev/null --max-time 8 http://example.com | grep -i '^date:' | sed 's/^[Dd]ate: //' | tr -d '\r')
if [ -n "$DH" ]; then
  EPOCH=$(date -d "$DH" +%s 2>/dev/null)
  if [ -n "$EPOCH" ]; then
    su -c "date -u @$EPOCH"
  fi
fi

# Tailscale é o app Android nativo (não roda via Termux), então não fica de pé
# sozinho após o boot — precisa ser aberto para reconectar à tailnet.
su -c "am start -n com.tailscale.ipn/.MainActivity" >/dev/null 2>&1

su -c "cd /data/data/com.termux/files/home/adguardhome && SSL_CERT_FILE=/data/data/com.termux/files/home/adguardhome/cert.pem nohup ./AdGuardHome -w /data/data/com.termux/files/home/adguardhome > adguard.log 2>&1 &"
cd /data/data/com.termux/files/home/intranet && nohup python3 server.py > server.log 2>&1 &
sshd -D
