"""Show-Steuerung: Ablauf einer Produktion Cue für Cue abfahren (Zustand nur im Speicher)."""

import time

from ..models.production import Cue, Production, ShowState
from .engine import NotFound
from .productions import Invalid, Productions

DEBOUNCE_S = 0.25  # zweites Weiter/Zurück innerhalb dieser Zeit wird ignoriert (Doppeldruck)


class NotRunning(Exception):
    """Aktion braucht eine laufende Show → 409."""


class Show:
    def __init__(self, productions: Productions) -> None:
        self.productions = productions
        self.engine = productions.engine
        self.lock = productions.lock
        self.state = ShowState()
        self.clock = time.monotonic  # in Tests austauschbar
        self._last_step = float("-inf")

    def payload(self) -> dict:
        with self.lock:
            self._sync()
            return self.state.model_dump()

    def _sync(self) -> bool:
        """Show an geänderte Produktionen anpassen (gelöscht → beenden, Cues entfernt → Index begrenzen).

        Liefert True, wenn sich der Zustand dadurch geändert hat."""
        st = self.state
        if not st.running:
            return False
        before = st.model_copy()
        p = next((p for p in self.productions.data.productions if p.id == st.productionId), None)
        if p is None or not p.cues:
            self.state = ShowState()
        else:
            st.cueIndex = min(st.cueIndex or 0, len(p.cues) - 1)
            st.atEnd = st.cueIndex == len(p.cues) - 1
        return self.state != before

    def sync(self) -> bool:
        with self.lock:
            return self._sync()

    def _production(self) -> Production:
        self._sync()
        if not self.state.running:
            raise NotRunning("Keine Show aktiv – bitte zuerst „Show starten“")
        return self.productions.get(self.state.productionId)

    def _go(self, p: Production, index: int) -> dict[str, dict]:
        """Cue `index` ausführen: Szene mit Cue-Fade (sonst Szenen-Fade) abrufen; Notiz-Cue lässt das Licht."""
        cue: Cue = p.cues[index]
        self.state.cueIndex = index
        self.state.atEnd = index == len(p.cues) - 1
        sc = p.scene(cue.sceneId) if cue.sceneId else None
        if sc is None:
            return {}
        return self.engine.apply_scene(sc, cue.fadeSeconds, cue.othersOff)

    def _debounced(self) -> bool:
        now = self.clock()
        if now - self._last_step < DEBOUNCE_S:
            return True
        self._last_step = now
        return False

    # ---------------------------------------------------------------- Aktionen
    # Rückgabe jeweils (geänderte Werte, Zustand hat sich geändert)

    def start(self, pid: str | None = None) -> tuple[dict[str, dict], bool]:
        with self.lock:
            pid = pid or self.productions.data.activeProductionId
            if pid is None:
                raise NotFound("keine aktive Produktion")
            p = self.productions.get(pid)
            if not p.cues:
                raise Invalid(f"Produktion „{p.name}“ hat keinen Ablauf")
            self.state = ShowState(running=True, productionId=p.id)
            self._last_step = float("-inf")
            return self._go(p, 0), True

    def next(self) -> tuple[dict[str, dict], bool]:
        with self.lock:
            p = self._production()
            if self._debounced():
                return {}, False
            if self.state.cueIndex >= len(p.cues) - 1:
                self.state.atEnd = True  # am Ende stehen bleiben
                return {}, False
            return self._go(p, self.state.cueIndex + 1), True

    def prev(self) -> tuple[dict[str, dict], bool]:
        with self.lock:
            p = self._production()
            if self._debounced() or self.state.cueIndex == 0:
                return {}, False
            return self._go(p, self.state.cueIndex - 1), True

    def goto(self, index: int) -> tuple[dict[str, dict], bool]:
        with self.lock:
            p = self._production()
            if not 0 <= index < len(p.cues):
                raise Invalid(f"Eintrag {index + 1} gibt es nicht (Ablauf hat {len(p.cues)} Einträge)")
            return self._go(p, index), True

    def stop(self) -> tuple[dict[str, dict], bool]:
        """Beendet die Show; das Licht bleibt, wie es ist."""
        with self.lock:
            self._production()
            self.state = ShowState()
            return {}, True
