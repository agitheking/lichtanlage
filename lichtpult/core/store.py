"""Persistenz als JSON-Dateien im Datenordner (atomar: tmp + rename)."""

import logging
import os
import shutil
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from ..config import DEFAULTS_DIR

log = logging.getLogger(__name__)
M = TypeVar("M", bound=BaseModel)


class Store:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def path(self, name: str) -> Path:
        return self.data_dir / name

    def load(self, name: str, model: type[M], default_file: str | None = None) -> M:
        """Lädt data/<name>; fehlt sie (oder ist kaputt), wird der Default verwendet."""
        p = self.path(name)
        if p.exists():
            try:
                return model.model_validate_json(p.read_text(encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                backup = p.with_suffix(p.suffix + ".broken")
                shutil.copy2(p, backup)
                log.error("%s ist ungültig (%s) – Sicherung unter %s, nehme Default", p, e, backup)
        if default_file:
            return self.load_default(default_file, model)
        return model()

    @staticmethod
    def load_default(default_file: str, model: type[M]) -> M:
        return model.model_validate_json((DEFAULTS_DIR / default_file).read_text(encoding="utf-8"))

    def save(self, name: str, obj: BaseModel) -> None:
        p = self.path(name)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_text(obj.model_dump_json(indent=2), encoding="utf-8")
        os.replace(tmp, p)
