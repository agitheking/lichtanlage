#!/usr/bin/env bash
# Installiert das Lichtpult auf einem Linux-Rechner (getestet für Fedora, läuft auch auf Debian/Ubuntu/Arch).
#
#   ./scripts/install.sh                 # Abhängigkeiten, Rechte fürs DMX-Interface
#   ./scripts/install.sh --autostart     # zusätzlich: startet beim Anmelden automatisch (systemd-Benutzerdienst)
#   ./scripts/install.sh --netz          # zusätzlich: auch vom Tablet/Handy im WLAN erreichbar (Port 8000)
#   ./scripts/install.sh --extras        # zusätzlich: mpv (Ton für Effekte) und Chromium (Zugfenster)
#
# DRY_RUN=1 zeigt nur, was passieren würde.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
AUTOSTART=0 NETZ=0 EXTRAS=0
for a in "$@"; do
  case "$a" in
    --autostart) AUTOSTART=1 ;;
    --netz) NETZ=1 ;;
    --extras) EXTRAS=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $a" >&2; exit 1 ;;
  esac
done

run() { if [[ "${DRY_RUN:-0}" == 1 ]]; then echo "  [dry-run] $*"; else "$@"; fi; }
say() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✔\033[0m %s\n' "$*"; }

. /etc/os-release 2>/dev/null || true
ID_LIKE_ALL="${ID:-} ${ID_LIKE:-}"
pkg_install() {
  if command -v dnf >/dev/null; then run sudo dnf install -y "$@"
  elif command -v apt-get >/dev/null; then run sudo apt-get install -y "$@"
  elif command -v pacman >/dev/null; then run sudo pacman -S --needed --noconfirm "$@"
  else echo "  Bitte von Hand installieren: $*"; fi
}

say "System: ${PRETTY_NAME:-unbekannt}"

# ---------------------------------------------------------------- uv
say "uv (Python-Paketverwaltung)"
if command -v uv >/dev/null; then
  ok "uv vorhanden: $(uv --version)"
else
  if [[ "$ID_LIKE_ALL" == *fedora* ]]; then pkg_install uv
  else run sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'; export PATH="$HOME/.local/bin:$PATH"; fi
fi
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"

say "Python-Abhängigkeiten"
run "$UV" sync --project "$DIR" --group effekte
ok "Abhängigkeiten installiert"

# ---------------------------------------------------------------- Rechte fürs DMX-Interface
say "Zugriff auf das DMX-Interface (/dev/ttyUSB*)"
GROUP=""
for g in dialout uucp; do getent group "$g" >/dev/null && { GROUP="$g"; break; }; done
if [[ -z "$GROUP" ]]; then
  echo "  Keine Gruppe dialout/uucp gefunden – bitte Rechte für /dev/ttyUSB* von Hand setzen."
elif id -nG "$USER" | tr ' ' '\n' | grep -qx "$GROUP"; then
  ok "$USER ist bereits in der Gruppe $GROUP"
else
  run sudo usermod -aG "$GROUP" "$USER"
  echo "  → $USER wurde zur Gruppe $GROUP hinzugefügt. Bitte einmal ab- und wieder anmelden!"
fi

# ModemManager soll das ENTTEC (FTDI 0403:6001) nicht als Modem abfragen
RULE=/etc/udev/rules.d/99-lichtpult-enttec.rules
if [[ -f "$RULE" ]]; then
  ok "udev-Regel vorhanden ($RULE)"
else
  run sudo tee "$RULE" >/dev/null <<'EOF'
# ENTTEC DMX USB Pro: nicht von ModemManager abfragen lassen, für die Gruppe dialout/uucp freigeben
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", ENV{ID_MM_DEVICE_IGNORE}="1", MODE="0660"
EOF
  run sudo udevadm control --reload-rules
  run sudo udevadm trigger --subsystem-match=tty
  ok "udev-Regel angelegt"
fi

# ---------------------------------------------------------------- Extras
if [[ $EXTRAS == 1 ]]; then
  say "Extras: mpv (Ton) und Chromium (Zugfenster)"
  pkg_install mpv chromium
fi

# ---------------------------------------------------------------- Netz
HOSTARG=""
if [[ $NETZ == 1 ]]; then
  say "Zugriff aus dem WLAN"
  HOSTARG="--host 0.0.0.0"
  if command -v firewall-cmd >/dev/null && run sudo firewall-cmd --state >/dev/null 2>&1; then
    run sudo firewall-cmd --permanent --add-port=8000/tcp
    run sudo firewall-cmd --reload
    ok "Port 8000 in der Firewall freigegeben"
  fi
  echo "  Achtung: Jeder im selben Netz kann dann das Licht steuern (es gibt kein Passwort)."
fi

# ---------------------------------------------------------------- Autostart
if [[ $AUTOSTART == 1 ]]; then
  say "Autostart (systemd-Benutzerdienst)"
  UNIT_DIR="$HOME/.config/systemd/user"
  run mkdir -p "$UNIT_DIR"
  UNIT="[Unit]
Description=Lichtpult (DMX-Steuerung Kellertheater)
After=network.target

[Service]
WorkingDirectory=$DIR
ExecStart=$UV run --project $DIR python -m lichtpult $HOSTARG
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target"
  if [[ "${DRY_RUN:-0}" == 1 ]]; then echo "$UNIT" | sed 's/^/  [dry-run] /'
  else echo "$UNIT" > "$UNIT_DIR/lichtpult.service"; fi
  run systemctl --user daemon-reload
  run systemctl --user enable --now lichtpult.service
  ok "Dienst lichtpult.service aktiv (Logs: journalctl --user -u lichtpult -f)"
  echo "  Soll er auch ohne Anmeldung laufen: sudo loginctl enable-linger $USER"
fi

say "Fertig"
cat <<EOF
  Starten (ohne Autostart):  $DIR/run.sh
  Im Browser öffnen:         http://localhost:8000
  Hardware-Test:             $UV run --project $DIR python $DIR/scripts/dmx_smoke.py --channel 16 --value 255
  Sicherung einspielen:      Einrichtung → Sicherung → Wiederherstellen
EOF
