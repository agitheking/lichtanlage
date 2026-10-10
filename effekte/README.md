# Effekte

Kleine Skripte, die über die Lichtpult-API laufende Effekte spielen. Das Lichtpult muss laufen
(`./run.sh`). Beenden mit **Strg+C** – danach gilt wieder die normale Steuerung.

| Skript | Effekt |
|---|---|
| `gewitter.py` | blaue Nacht, laufende Blitze über die drei LED-PARs |
| `lauflicht.py` | weiche Lichtwelle über das Rohr (`--tempo`, `--breite`, `--hell`) |
| `eisenbahn.py` | Nachtzug: Abteillicht, vorbeiziehende Laternen, Tunnel |
| `sommer.py` | Sonnenlicht mit Laubflirren und Vogelgezwitscher (braucht `--group effekte`) |

```bash
uv run python effekte/gewitter.py
uv run python effekte/lauflicht.py --tempo 3
uv run --group effekte python effekte/sommer.py
```

Alle Skripte haben `--dauer SEKUNDEN`. Die DMX-Adressen der LED-PARs (49, 61, 73) und die
Scheinwerfer-IDs entsprechen dem vermessenen Rig des Kellertheaters.

Das virtuelle Zugfenster für einen zweiten Monitor ist Teil der App:
`http://localhost:8000/static/fenster.html?licht=1` (Tasten: T Tunnel, B Brücke, +/− Tempo, P Pfeife, F Vollbild).
