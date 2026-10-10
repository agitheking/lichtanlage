# Architektur- und Umsetzungsplan

Plan erstellt mit Claude Fable 5.1, umgesetzt mit Claude Opus 5.5 (2026-10-10).

## Entscheidung

HTML-Frontend + Python-Backend wie vorgeschlagen, konkret:

- **FastAPI + uvicorn + pyserial + pydantic v2.** Ein Prozess liefert REST, WebSocket und die statischen Dateien.
  pydantic validiert Gerätetypen und Rig. Kein `uvicorn[standard]` (reine Python-Abhängigkeiten).
- **WebSocket für alles Live** (Fader, Status, Änderungen an alle Clients), **REST für CRUD/Persistenz**.
  Der Server ist die einzige Quelle der Wahrheit; mehrere Browser (Laptop + Tablet) bleiben synchron.
- **DMX-Ausgabe in eigenem Thread** mit 40 Hz (blockierendes `serial.write`), Simulationsmodus ohne Port,
  Reconnect alle 2 s nach Abziehen.
- **Frontend ohne Build-Schritt:** ES-Module + Importmap, three.js 0.180 lokal in `static/vendor/`
  (Theater evtl. offline), kein Framework.
- **Persistenz:** JSON-Dateien in `data/` (gitignored, atomar geschrieben), Defaults im Paket.

## Koordinatensystem der Bühne

x = links→rechts aus Publikumssicht, y = oben, z = zum Publikum. Ursprung = Mitte der Bühnenvorderkante
auf Saalbodenhöhe. Einheit Meter. Schätzwerte vom Foto in `lichtpult/defaults/stage.default.json`:

- Podest 7,0 × 4,5 m, 0,40 m hoch, Vorderkante Kreisbogen (Mittelpunkt z = −5,7, r = 5,7)
- Lichtbogen (Kabelkanal) konzentrisch, r = 6,3, Höhe 2,45 m, ±38,2°; Position eines Scheinwerfers am
  Bogen als Parameter `t` ∈ [0, 1] (links → rechts)
- Tonnengewölbe ±4,2 m, Kämpfer 2,0 m, Scheitel 3,3 m
- Rückwand mit Flats, Kaminöffnung, Vulkan-Tür, heller Tür, schräger Seitenwand; Vorhänge links rot/türkis/creme,
  rechts gelb/rot; Lüftungsrohr rechts; Sofa, Ledersessel, Kommode, Kisten

## Default-Rig (vom Foto, im Wizard zu prüfen)

15 Geräte am Bogen (`t` 0,02 … 0,96) + ein Profiler an der Decke. Runde Cameo-LEDs als
„Dimmer + RGBW (5 Kanäle)“, eckige LED-Flächen als „Dimmer, Strobe, RGBW, Programm, Speed (8 Kanäle)“,
ein bronzefarbenes Halogengerät als 1-Kanal-Dimmer. Adressen 1, 9, 17, … als „ungeprüft“ markiert.

## Datenmodell

- **FixtureType:** Kanäle mit Rolle (`dimmer, red, green, blue, white, amber, uv, cct, warm, cold, strobe,
  zoom, pan, tilt, program, other`), Grundwert, Testwert (`highlight`), Kegelwinkel, Form, Farbmodell.
- **Fixture:** Adresse, Typ, Montage (`arc` mit `t` oder `free` mit Position), Ziel, Kegel, Gruppen, `verified`.
- **StageState:** je Scheinwerfer `dimmer, r, g, b, w, a, cct, strobe` (0…1), Grand Master, Blackout.
- **Ebenen der Ausgabe:** Werte → Patch → Überblendung → Roh-Overrides (Einrichtung, optional „solo“) → Identify-Blinken.

## Geführte Einrichtung

0. Start: komplette Einrichtung / einen Scheinwerfer / neuen hinzufügen
1. Interface prüfen (Status, Neu suchen, 3-Sekunden-Volltest)
2. Vorbereitung (Checkliste)
3. Bestandsaufnahme (hinzufügen/entfernen)
4. Je Scheinwerfer, von links nach rechts:
   a. **Adresse:** ablesen *oder* suchen. Die Suche schaltet die Kanäle *m … 512* ein und fragt „leuchtet er noch?“.
      Mit der Halbierung ist die Startadresse nach ≈ 9 Fragen gefunden. Funktioniert für jeden Gerätetyp, weil das
      Gerät genau dann leuchtet, wenn alle seine Kanäle an sind (m ≤ Startadresse).
      *Abweichung vom ursprünglichen Plan (8er-Blockscan): Der Blockscan übersieht Geräte, deren Kanäle eine
      Blockgrenze überspannen.*
   b. Typ wählen, Blinken/Voll an/Farbtest; sonst **Kanal-Erkunder** → eigener Gerätetyp
   c. Position am Rohr (Slider oder Klick aufs Rohr) bzw. frei
   d. Ausrichtung: Scheinwerfer an, Klick auf den Lichtfleck im 3D-Bild, Kegelbreite
   e. Name und Gruppen
   f. Zusammenfassung, Konfliktwarnung, Test, Speichern (`verified`)
5. Abschluss: Tabelle, Konflikte, Lauflicht, Sicherung

## Meilensteine

| | Inhalt | Prüfung |
|---|---|---|
| M0 | Gerüst, uv, three.js vendored | Server startet, pytest grün |
| M1 | ENTTEC-Paket, Fade, Ausgabethread, Discovery, Smoke-Skript | `test_enttec`, `test_fade` |
| M2 | Modelle, Defaults, Patch, Store, Engine, REST, WebSocket | `test_patch`, `test_engine`, `test_api`, `test_ws` |
| M3 | 3D-Kulisse und Scheinwerfer | Sichtprüfung im Browser |
| M4 | Live-Steuerung, Picking, Fader, Farbe, GM/Blackout | Browser (Sim) |
| M5 | Admin, Wizard, Kanal-Erkunder, DMX-Monitor | Wizard-Durchlauf im Sim-Modus |
| M6 | Szenen, Export/Import, Autosave | Browser + Tests |

## Offene Fragen

1. Genaue Modelle/Kanalmodi der Cameo-Geräte (Foto vom Display) → exakte eingebaute Typen.
2. Hängen konventionelle Geräte an einem DMX-Dimmerpack? Adresse/Kanalzahl?
3. Blackout beim Beenden gewünscht? (Standard: nein, das Interface hält den letzten Zustand)
4. Bedienung auch per Tablet im Saal? (`--host 0.0.0.0`; Layout ist darauf vorbereitet)
