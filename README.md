# Lichtpult – Kellertheater

Lichtsteuerung im Browser für die kleine Gewölbebühne: 3D-Nachbildung der Bühne,
Scheinwerfer anklicken und dimmen, Szenen mit Überblendung, und eine **geführte
Einrichtung**, die DMX-Adressen auch ohne Display per Ja/Nein-Fragen findet.

- **Backend:** Python (FastAPI, pyserial), DMX-Ausgabe mit 40 Hz über **ENTTEC DMX USB Pro**
- **Frontend:** HTML + ES-Module + three.js (lokal unter `static/vendor/`, läuft offline), kein Build-Schritt

## Installation (Fedora, Debian/Ubuntu, Arch)

```bash
git clone <repo-url> lichtanlage && cd lichtanlage
./scripts/install.sh --extras --autostart     # optional: --netz für Tablet-Zugriff
```

Das Skript installiert uv und die Python-Pakete, nimmt den Benutzer in die Gruppe für serielle
Geräte auf (`dialout` bzw. `uucp` – danach einmal ab- und anmelden), hält ModemManager vom
ENTTEC-Interface fern und richtet auf Wunsch einen systemd-Benutzerdienst ein.
Eigene Szenen/Änderungen liegen in `data/` (nicht im Git) – vom alten Rechner unter
**Einrichtung → Sicherung** exportieren und auf dem neuen wiederherstellen.

## Starten

```bash
./run.sh                 # sucht das ENTTEC-Interface automatisch
./run.sh --sim           # ohne Interface (Simulation)
./run.sh --host 0.0.0.0  # auch vom Tablet/Handy im WLAN erreichbar
```

Dann <http://localhost:8000> öffnen. Voraussetzung: [uv](https://docs.astral.sh/uv/)
(installiert die Abhängigkeiten beim ersten Start selbst).

Weitere Optionen: `--serial /dev/ttyUSB0`, `--port 8000`, `--data-dir PFAD`,
`--blackout-on-exit` (Standard: Licht bleibt beim Beenden, wie es ist).

### Hardware-Test ohne Oberfläche

```bash
uv run python scripts/dmx_smoke.py --channel 1 --value 255
uv run python scripts/dmx_smoke.py --chase --start 1 --end 64
```

Unter Linux muss der Benutzer Zugriff auf `/dev/ttyUSB*` haben (Gruppe `uucp` bzw. `dialout`).

## Effekte und Zugfenster

Laufende Effekte (Gewitter, Lauflicht, Nachtzug, Sommer mit Vogelgezwitscher) liegen als Skripte in
[`effekte/`](effekte/README.md), z. B. `uv run python effekte/gewitter.py` (Strg+C beendet).
Das virtuelle Zugfenster für einen zweiten Monitor: `http://localhost:8000/static/fenster.html?licht=1`.

## Bedienung

| Tab | Zweck |
|---|---|
| **Bühne** | Scheinwerfer im 3D-Bild anklicken (Umschalt = mehrere), Helligkeit/Farbe stellen, Fader-Leiste unten. Tasten: `A` alle, `Esc` keine, `B` Blackout |
| **Szenen** | aktuelles Licht speichern, mit Überblendzeit abrufen (Tasten `1`–`9`) |
| **Einrichtung** | geführte Tour (Interface prüfen → Bestandsaufnahme → je Scheinwerfer Adresse, Typ, Position, Ausrichtung, Name), Liste, Gerätetypen, Bühnenmaße, DMX-Monitor, Sicherung |

**Adresssuche:** Die Einrichtung schaltet die Kanäle *m … 512* ein und fragt, ob der
markierte Scheinwerfer leuchtet. Mit der Halbierung ist die Startadresse nach etwa
9 Fragen gefunden, ganz ohne Display am Gerät.

Unbekannte Geräte lassen sich über **„Kanäle selbst erkunden“** Kanal für Kanal
ausprobieren und als eigener Gerätetyp speichern.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `lichtpult/dmx/` | ENTTEC-Paketformat, Port-Suche, 40-Hz-Ausgabethread mit Auto-Reconnect, Simulation |
| `lichtpult/core/engine.py` | Pult-Zustand: Rig, Typen, Werte, Grand Master/Blackout, Szenen, Roh-Overrides, Identify |
| `lichtpult/core/patch.py` | Werte (Dimmer, RGBW, CCT …) → 512-Byte-Frame je Gerätetyp, Adresskonflikte |
| `lichtpult/core/fade.py` | Überblendung auf Kanalebene |
| `lichtpult/api/` | REST (`/api/...`) und WebSocket (`/ws`) |
| `lichtpult/defaults/` | Gerätebibliothek, Bühnenmaße, Rig (16 Scheinwerfer, Adressen per Kamera vermessen) und Standard-Stimmungen |
| `static/js/scene/` | three.js: Kulisse, Scheinwerfer mit Spotlights und Lichtkegeln, Picking |
| `static/js/ui/` | Tabs, Wizard, Kanal-Erkunder |
| `data/` | Laufzeitdaten (nicht im Git): `rig.json`, `stage.json`, `scenes.json`, … |
| `effekte/` | Effekt-Skripte (Gewitter, Lauflicht, Eisenbahn, Sommer) |
| `static/fenster.html` | virtuelles Zugfenster, steuert die Fenster-LEDs mit |
| `scripts/install.sh` | Installation inkl. Autostart |
| `docs/architektur.html` | interaktives Architekturdiagramm (Quelle: `docs/architektur.json`, erzeugt mit archify) |
| `docs/PLAN.md` | Architektur- und Umsetzungsplan |

## Entwicklung

```bash
uv run pytest
./scripts/vendor_three.sh   # three.js neu herunterladen (nur bei Versionswechsel)
```
