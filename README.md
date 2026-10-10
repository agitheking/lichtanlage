# Lichtpult – Kellertheater

Lichtsteuerung im Browser für die kleine Gewölbebühne: 3D-Nachbildung der Bühne,
Scheinwerfer anklicken und dimmen, Szenen mit Überblendung, Produktionen mit Ablauf und
Show-Modus, und eine **geführte
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
| **Szenen** | Szenen-Bibliothek: aktuelles Licht speichern, mit Überblendzeit abrufen (Tasten `1`–`9`), in eine Produktion kopieren, als Datei exportieren/importieren |
| **Produktionen** | je Stück eigene Szenen und ein Ablauf mit Notizen, Show-Modus mit Leertaste – siehe [Produktionen](#produktionen) |
| **Einrichtung** | geführte Tour (Interface prüfen → Bestandsaufnahme → je Scheinwerfer Adresse, Typ, Position, Ausrichtung, Name), Liste, Gerätetypen, Bühnenmaße, DMX-Monitor, Sicherung |

**Adresssuche:** Die Einrichtung schaltet die Kanäle *m … 512* ein und fragt, ob der
markierte Scheinwerfer leuchtet. Mit der Halbierung ist die Startadresse nach etwa
9 Fragen gefunden, ganz ohne Display am Gerät.

Unbekannte Geräte lassen sich über **„Kanäle selbst erkunden“** Kanal für Kanal
ausprobieren und als eigener Gerätetyp speichern.

## Produktionen

Für jedes Stück lässt sich im Tab **Produktionen** eine eigene Produktion anlegen (Dropdown oben:
„+ Neu“, „Umbenennen“, „Löschen“). Die gewählte Produktion ist aktiv und wird auf dem Server gemerkt.

- **Szenen:** wie in der Bibliothek – aktuelles Licht speichern, abrufen (`1`–`9`), sortieren,
  überschreiben. „Aus Bibliothek kopieren“ übernimmt Szenen als eigenständige Kopien; umgekehrt hat
  jede Bibliotheksszene den Knopf „In Produktion kopieren“. Die Bibliothek selbst bleibt unverändert
  (die Effekt-Skripte schreiben weiter dorthin).
- **Ablauf:** die Reihenfolge der Show. Jeder Eintrag verweist auf eine Szene der Produktion (dieselbe
  Szene darf mehrfach vorkommen), hat optional eine eigene Überblendzeit (leer = die der Szene) und eine
  **Notiz** für den Techniker, z. B. „Stichwort: Eisenbahn“. Einträge ohne Szene sind reine Notizen und
  ändern das Licht nicht. Wird eine Szene gelöscht, bleibt der Eintrag als Notiz stehen (rot markiert).
- **Show-Modus** („Show starten“): zeigt groß den aktuellen und den nächsten Eintrag samt Notiz.

  | Taste | Wirkung |
  |---|---|
  | `Leertaste`, `→`, `Bild ↓` | nächster Eintrag |
  | `←`, `Rücktaste`, `Bild ↑` | vorheriger Eintrag |
  | Klick auf eine Zeile | dorthin springen |
  | `Esc` | Show beenden |
  | `B` | Blackout (die Position im Ablauf bleibt) |

  Alle geöffneten Browser zeigen dieselbe Position; nach einem Neuladen geht es an derselben Stelle weiter.
- **Export/Import:**
  - Kopfzeile „Exportieren“ speichert die ganze Produktion (Szenen und Ablauf) als `<name>.produktion.json`.
    „Importieren“ lädt eine solche Datei. Gibt es die Produktion schon, kann man sie **ersetzen** oder
    **als Kopie anlegen**.
  - Neben der Überschrift „Szenen“ (in der Produktion und in der Bibliothek) gibt es „Exportieren“ und
    „Importieren“ nur für die Szenen (`<name>.szenen.json` bzw. `bibliothek.szenen.json`). Beim
    Import wählt man **Zusammenführen** (neue anhängen, gleiche Kennung überschreiben) oder **Ersetzen**.
    Akzeptiert werden auch eine alte `scenes.json` und die Szenen aus einer Produktionsdatei.
  - Die Gesamtsicherung unter **Einrichtung → Sicherung** enthält alle Produktionen; beim Wiederherstellen
    werden sie mit übernommen. Ältere Sicherungen ohne Produktionen lassen die vorhandenen unverändert.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `lichtpult/dmx/` | ENTTEC-Paketformat, Port-Suche, 40-Hz-Ausgabethread mit Auto-Reconnect, Simulation |
| `lichtpult/core/engine.py` | Pult-Zustand: Rig, Typen, Werte, Grand Master/Blackout, Szenen, Roh-Overrides, Identify |
| `lichtpult/core/productions.py`, `show.py`, `transfer.py` | Produktionen (Szenen + Ablauf), Show-Steuerung, Export/Import |
| `lichtpult/core/patch.py` | Werte (Dimmer, RGBW, CCT …) → 512-Byte-Frame je Gerätetyp, Adresskonflikte |
| `lichtpult/core/fade.py` | Überblendung auf Kanalebene |
| `lichtpult/api/` | REST (`/api/...`) und WebSocket (`/ws`) |
| `lichtpult/defaults/` | Gerätebibliothek, Bühnenmaße, Rig (16 Scheinwerfer, Adressen per Kamera vermessen) und Standard-Stimmungen |
| `static/js/scene/` | three.js: Kulisse, Scheinwerfer mit Spotlights und Lichtkegeln, Picking |
| `static/js/ui/` | Tabs, Wizard, Kanal-Erkunder; Produktionen: `productions-tab.js`, `scene-list.js`, `cues-tab.js`, `transfer.js` |
| `data/` | Laufzeitdaten (nicht im Git): `rig.json`, `stage.json`, `scenes.json`, `productions.json`, … |
| `effekte/` | Effekt-Skripte (Gewitter, Lauflicht, Eisenbahn, Sommer) |
| `static/fenster.html` | virtuelles Zugfenster, steuert die Fenster-LEDs mit |
| `scripts/install.sh` | Installation inkl. Autostart |
| `docs/architektur.html` | interaktives Architekturdiagramm (Quelle: `docs/architektur.json`, erzeugt mit archify) |
| `docs/PLAN.md` | Architektur- und Umsetzungsplan |
| `docs/PRODUKTIONEN.md` | Spezifikation Produktionen (Szenen + Ablauf) |

## Entwicklung

```bash
uv run pytest
./scripts/vendor_three.sh   # three.js neu herunterladen (nur bei Versionswechsel)
```
