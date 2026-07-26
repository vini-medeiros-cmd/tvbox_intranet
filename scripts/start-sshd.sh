#!/data/data/com.termux/files/usr/bin/sh
# Disparado pelo Termux:Boot a cada boot do Android.
# Roda como executável dentro de ~/.termux/boot/ no Termux.
termux-wake-lock
su -c "cd /data/data/com.termux/files/home/adguardhome && SSL_CERT_FILE=/data/data/com.termux/files/home/adguardhome/cert.pem nohup ./AdGuardHome -w /data/data/com.termux/files/home/adguardhome > adguard.log 2>&1 &"
cd /data/data/com.termux/files/home/intranet && nohup python3 server.py > server.log 2>&1 &
sshd -D
