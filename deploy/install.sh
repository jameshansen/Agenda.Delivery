#!/bin/sh
# Installs agenda.delivery on Ubuntu 22.04+ as an unprivileged "agenda" user. Run as root from the repo checkout.
set -eu
SRC=$(cd "$(dirname "$0")/.." && pwd)

# Caddy comes first: the php-fpm pool hands its socket to the caddy user, and php-fpm won't start without it.
# --no-upgrade leaves anything already installed alone, since the server may run other sites.
apt-get install -y --no-upgrade caddy php-cli poppler-utils python3-venv sqlite3 curl xvfb
# The PHP modules for the version the php command runs, which may not be the newest one installed.
PHPV=$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')
apt-get install -y --no-upgrade php$PHPV-fpm php$PHPV-sqlite3 php$PHPV-curl php$PHPV-mbstring php$PHPV-xml
# Google's Chrome .deb, since Ubuntu's chromium is a snap that chromedriver can't drive cleanly.
if ! command -v google-chrome >/dev/null; then
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/chrome.deb && rm /tmp/chrome.deb
fi

id agenda >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/agenda --shell /usr/sbin/nologin agenda

# Code lives in /opt/agenda, data in /var/lib/agenda.
# Copied over the top, so config.php and the Python venv from an earlier install stay.
install -d /opt/agenda
if [ "$SRC" != /opt/agenda ]; then
  (cd "$SRC" && tar --exclude=./config.php --exclude='./config.*.php' --exclude=./data --exclude=./.git -cf - .) | tar --no-same-owner -xf - -C /opt/agenda
  # The exclude above keeps local configs with keys in them out; the example holds every default, so it goes in.
  cp "$SRC/config.example.php" /opt/agenda/
fi
# The code belongs to root, so nothing running as agenda (php, the service, an agent) can change it.
chown -R root:root /opt/agenda && chmod -R go-w /opt/agenda
[ -f /opt/agenda/config.php ] || cp /opt/agenda/config.example.php /opt/agenda/config.php
chown root:agenda /opt/agenda/config.php && chmod 640 /opt/agenda/config.php
install -d -o agenda -g agenda -m 750 /var/lib/agenda /var/lib/agenda/agents

# Browser and captions: one small venv for undetected-chromedriver and yt-dlp.
[ -x /opt/agenda/venv/bin/python ] || python3 -m venv /opt/agenda/venv
/opt/agenda/venv/bin/pip install -q --upgrade undetected-chromedriver setuptools yt-dlp
ln -sf /opt/agenda/venv/bin/yt-dlp /usr/local/bin/yt-dlp
# WhatsApp destinations: the Baileys bridge's packages, at the versions in its lockfile. Skipped without Node.
if command -v npm >/dev/null; then (cd /opt/agenda/whatsapp && npm ci --omit=dev --no-audit --no-fund); fi
# The real binary path, since NullClaw's shell sandbox can't follow /usr/bin/php through /etc/alternatives.
sed "s#/usr/bin/php#$(readlink -f "$(command -v php)")#" /opt/agenda/deploy/adtool > /usr/local/bin/adtool
chmod 755 /usr/local/bin/adtool

# NullClaw, a single static binary.
if [ ! -x /usr/local/bin/nullclaw ]; then
  curl -fsSL -o /tmp/nullclaw "https://github.com/nullclaw/nullclaw/releases/download/v2026.5.29/nullclaw-linux-x86_64.bin"
  # The release agenda.delivery was tested with; anything else is refused.
  echo "966c524d3816531371e8657ffc84c40f47d94db89f6c70e816adce983e6d1f0a  /tmp/nullclaw" | sha256sum -c -
  install -m 755 /tmp/nullclaw /usr/local/bin/nullclaw && rm /tmp/nullclaw
fi

# The agenda delivery service runs every agent and its tools, as the agenda user.
cp /opt/agenda/deploy/systemd/agenda-delivery.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable agenda-delivery.service
systemctl restart agenda-delivery.service

# Web: a php-fpm pool running as agenda, behind Caddy.
sed "s#/etc/php/8.1/#/etc/php/$PHPV/#" /opt/agenda/deploy/php-fpm-pool.conf > /etc/php/$PHPV/fpm/pool.d/agenda.conf
systemctl reload php$PHPV-fpm
echo "Installed. Fill in /opt/agenda/config.php, then add deploy/Caddyfile to your Caddy config."
