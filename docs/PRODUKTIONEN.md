# Feature: Produktionen (Szenen + Ablauf)

Anforderung (Nutzer, 2026-10-10), geprüft mit Claude Fable 5.1, Umsetzung in Subtasks T1–T5.

> Neuer Tab „Produktionen“ in der Kopfleiste mit den Untertabs **Szenen** und **Ablauf**.
> Szenen wie der bisherige Szenen-Tab. Im Ablauf können Szenen mehrfach vorkommen. „Start“ ruft
> die erste Szene ab, Leertaste die nächste usw. Notizen pro Eintrag („Hamlet kommt raus“,
> „Stichwort: Eisenbahn“), damit der Techniker richtig drückt. Alles import-/exportierbar.

## Entscheidungen des Nutzers

1. **Mehrere Produktionen**, frei anlegbar (Neu/Umbenennen/Löschen), Auswahl per Dropdown; eine ist aktiv
   (serverseitig gespeichert). Jede Produktion hat **eigene Szenen** und **einen eigenen Ablauf**.
2. **Ablauf-Einträge (Cues) referenzieren Produktionsszenen** (keine Kopie): Wird eine Szene geändert,
   wirkt das in allen Cues, die auf sie verweisen.
3. Der **bisherige Szenen-Tab bleibt als „Bibliothek“** unverändert (14 Szenen, Effekt-Skripte schreiben
   weiter dorthin). Zusätzlich:
   - im Bibliothek-Tab ein Button **„In Produktion kopieren“** (pro Szene; Ziel-Produktion wählbar, Standard: aktive),
   - im Produktions-Untertab Szenen ein Button **„Aus Bibliothek kopieren“** (Mehrfachauswahl).
   Kopieren erzeugt eine eigenständige Kopie (neue ID in der Produktion, danach unabhängig).
4. **Export/Import**: ganze Produktion (Szenen + Ablauf) als eine Datei; zusätzlich nur Szenen
   (Produktion **und** Bibliothek) als eigene Datei. Ein Ablauf allein wird nicht exportiert.
   Die Gesamtsicherung (Einrichtung → Sicherung) enthält auch die Produktionen.
5. Cue = optionale Szene + **eigene Überblendzeit** (leer = Fade der Szene) + **Notiz**.
   **Reine Notiz-Cues** (ohne Szene) ändern das Licht nicht.
6. Show-Steuerung mit **Zurück** und **Springen** (Klick auf Zeile).

## Datenmodell (`lichtpult/models/production.py`)

```python
class Cue(BaseModel):
    id: str                           # kurze uuid4-hex, KEIN Slug (Szenen kommen mehrfach vor)
    sceneId: str | None = None        # Referenz auf Production.scenes[].id; None = Notiz-Cue
    fadeSeconds: float | None = None  # None = fadeSeconds der Szene; 0..120
    note: str = ""                    # max. 300 Zeichen
    othersOff: bool = True            # nicht enthaltene Scheinwerfer ausschalten (wie Szenen-Abruf)

class Production(BaseModel):
    id: str                           # Slug aus dem Namen, eindeutig
    name: str
    scenes: list[Scene] = []          # dieselbe Scene-Klasse wie die Bibliothek (models/state.py)
    cues: list[Cue] = []
    createdAt: str = ""

class ProductionList(BaseModel):
    version: int = 1
    activeProductionId: str | None = None
    productions: list[Production] = []

class ShowState(BaseModel):           # nur im Speicher, nicht persistiert
    running: bool = False
    productionId: str | None = None
    cueIndex: int | None = None       # None = vor Start
    atEnd: bool = False
```

- Validierung: jede `cue.sceneId` muss in `production.scenes` existieren (sonst 422 beim Anlegen/Ändern).
- Löschen einer Produktionsszene setzt `sceneId` aller betroffenen Cues auf `null` (Cue bleibt als Notiz-Cue,
  UI markiert „Szene fehlt“). Nie blockieren – die Probe darf nicht hängen.
- Persistenz: `data/productions.json` (atomar wie die anderen Dateien), Default
  `lichtpult/defaults/productions.default.json` (eine Beispiel-Produktion mit Szene „Blackout“ und
  zwei Beispiel-Cues). Bibliothek `scenes.json` bleibt unangetastet.

## REST

```
GET    /api/productions                                   → ProductionList
POST   /api/productions {name}                            → Production
PUT    /api/productions/{pid} {name}
DELETE /api/productions/{pid}
POST   /api/productions/{pid}/activate

GET    /api/productions/{pid}/scenes
POST   /api/productions/{pid}/scenes/capture {name, fade, sceneId?}   (aktuelles Licht)
PUT    /api/productions/{pid}/scenes/{sid} {name?, fadeSeconds?}
DELETE /api/productions/{pid}/scenes/{sid}
POST   /api/productions/{pid}/scenes/reorder {ids}
POST   /api/productions/{pid}/scenes/{sid}/recall {fade?, othersOff?}
POST   /api/productions/{pid}/scenes/copy-from-library {sceneIds: [...]}  → kopierte Szenen

POST   /api/productions/{pid}/cues {sceneId?, fadeSeconds?, note, othersOff?}
PUT    /api/productions/{pid}/cues/{cid}
DELETE /api/productions/{pid}/cues/{cid}
POST   /api/productions/{pid}/cues/reorder {ids}

GET    /api/show                                          → ShowState
POST   /api/show/start {productionId}                     → Cue 0 ausführen
POST   /api/show/next | /api/show/prev | /api/show/stop
POST   /api/show/goto {cueIndex}

GET    /api/productions/{pid}/export          → {"format":"lichtpult-production","version":1,"exportedAt":…,"production":{…}}
GET    /api/productions/{pid}/scenes/export   → {"format":"lichtpult-scenes","version":1,"exportedAt":…,"scenes":[…]}
GET    /api/scenes/export                     → dasselbe Szenen-Format für die Bibliothek
POST   /api/productions/import {…export…, mode: "new"|"replace"}   (gleiche id ohne mode → 409)
POST   /api/productions/{pid}/scenes/import {scenes|…export…, mode: "merge"|"replace"}
POST   /api/scenes/import {…, mode: "merge"|"replace"}            (Bibliothek)
```

- Szenen-Import akzeptiert das Header-Format, eine rohe Liste und das alte `{"scenes":[…]}`.
- Imports sind atomar (erst vollständig validieren, dann schreiben), Fehler → 422 mit verständlicher Meldung.
- `GET /api/export` enthält zusätzlich `productions.json`; `POST /api/import` übernimmt es optional
  (fehlt der Schlüssel, bleiben die Produktionen unverändert).
- Show: „Ausführen“ eines Cues = wenn `sceneId` gesetzt, Szene mit `cue.fadeSeconds ?? scene.fadeSeconds`
  und `othersOff` abrufen; Notiz-Cue ändert das Licht nicht. `next` am Ende bleibt stehen, `atEnd: true`;
  `prev` bei 0 bleibt 0; `goto` außerhalb → 422; `next/prev/goto` ohne laufende Show → 409.
  Serverseitige Entprellung: zweites `next`/`prev` innerhalb 250 ms wird ignoriert.
- Gemeinsame Recall-Logik für Bibliothek und Produktionen (in `engine.py` extrahieren, kein Duplikat).

## WebSocket

- `{"type":"productions","productions":[…],"activeProductionId":…}` nach jeder Änderung und im `hello`.
- `{"type":"show","show":{…ShowState…}}` nach jedem Show-Schritt und im `hello`.

## Oberfläche

- Kopfleiste: Tabs **Bühne · Szenen (Bibliothek) · Produktionen · Einrichtung**. Hash-Routing
  `#produktionen/szenen`, `#produktionen/ablauf`.
- Produktionen-Tab, Kopfzeile: Dropdown (aktive Produktion), „+ Neu“, „Umbenennen“, „Löschen“,
  „Exportieren“, „Importieren“.
- **Szenenliste als wiederverwendbare Komponente** (`static/js/ui/scene-list.js`), genutzt von Bibliothek
  und Produktions-Szenen. Der Bibliothek-Tab verhält sich exakt wie bisher, plus Button „In Produktion kopieren“.
- **Ablauf (Editor)**: Tabelle Nr. · Szene (Dropdown aus Produktionsszenen + „– nur Notiz –“) ·
  Fade (leer = Szene) · Notiz · ↑ ↓ Löschen; „+ Eintrag“; großer Button **„Show starten“**.
  Fehlende Szene rot markiert.
- **Show-Modus**: groß „AKTUELL: 7 – Nacht – Stichwort: Wer da?“ und „NÄCHSTER: 8 – …“; Liste mit
  Hervorhebung, aktueller Cue wird ins Bild gescrollt; Buttons „◀ Zurück“, „Weiter ▶“ (groß), „Beenden“.
  Tasten: Leertaste/→/PageDown = weiter, ←/Backspace/PageUp = zurück, Esc = beenden;
  `preventDefault` auf Leertaste, nach Klick `blur()`; Kürzel 1–9 im Show-Modus aus; Editieren ausgeblendet.
  Alle Aktionen gehen an `/api/show/*`, die Anzeige folgt dem WS-Event `show` (alle Browser synchron,
  Reload stellt den Zustand per `GET /api/show` wieder her). Taste B (Blackout) bleibt global; die
  Show-Position ändert sich dadurch nicht.

## Subtasks

| Task | Inhalt | hängt ab von | parallel zu |
|---|---|---|---|
| T1 | Backend: Modell, Persistenz, CRUD für Produktionen/Szenen/Cues, copy-from-library, WS `productions` | – | – |
| T2 | Backend: Show-Steuerung, Export/Import (Produktion, Szenen, Bibliothek, Gesamtsicherung) | T1 | T3 |
| T3 | Frontend: `scene-list.js`-Komponente, Produktionen-Tab mit Untertab Szenen, Kopier-Buttons | T1 | T2 |
| T4 | Frontend: Ablauf-Editor + Show-Modus | T2, T3 | T5 |
| T5 | Frontend: Export/Import-UI, Sicherung, Doku/README | T2, T3 | T4 |

Branches: `feature/produktionen-t1` … `t5`. Jede Task: Tests grün (`uv run pytest`), Branch pushen,
nicht nach `main` mergen – das übernimmt die Haupt-Session.
