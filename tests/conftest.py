import warnings

import pytest

warnings.filterwarnings("ignore", category=DeprecationWarning)

from fastapi.testclient import TestClient  # noqa: E402

from lichtpult.core.engine import Engine  # noqa: E402
from lichtpult.core.store import Store  # noqa: E402
from lichtpult.main import create_app  # noqa: E402


@pytest.fixture
def engine(tmp_path):
    return Engine(Store(tmp_path))


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path, sim=True)) as c:
        yield c
