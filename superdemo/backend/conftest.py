# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Shared pytest fixtures for the backend.

Auth is always enforced in the running app, so tests inject a fake
authenticated user via FastAPI's dependency_overrides. This keeps the existing
proxy/demos/logging tests free of tokens and network calls while the real
verification code still ships. The Firestore allowlist is replaced by an
in-memory fake (`fake_allowlist`).
"""

import pytest

import allowlist_store
from main import app
from auth import get_current_user


@pytest.fixture(autouse=True)
def _override_auth():
    app.dependency_overrides[get_current_user] = lambda: {
        "email": "tester@example.com",
        "uid": "test-uid",
        "is_admin": True,
    }
    yield
    app.dependency_overrides.pop(get_current_user, None)


class FakeAllowlistDoc:
    """In-memory stand-in for the Firestore superdemo/allowlist document."""

    def __init__(self):
        self.data: dict[str, list[str]] = {k: [] for k in allowlist_store.KINDS}
        self.fail_reads = False
        self.fail_writes = False
        self.reads = 0
        self.writes = 0

    def read(self) -> dict:
        self.reads += 1
        if self.fail_reads:
            raise RuntimeError("firestore down")
        return {k: list(v) for k, v in self.data.items()}

    def write(self, kind: str, value: str, add: bool, actor: str) -> None:
        if self.fail_writes:
            raise RuntimeError("firestore down")
        self.writes += 1
        items = self.data.setdefault(kind, [])
        if add and value not in items:
            items.append(value)
        elif not add and value in items:
            items.remove(value)


@pytest.fixture(autouse=True)
def fake_allowlist(monkeypatch):
    """Every test gets an empty in-memory allowlist; nothing touches Firestore."""
    fake = FakeAllowlistDoc()
    monkeypatch.setattr(allowlist_store, "_read_doc", fake.read)
    monkeypatch.setattr(allowlist_store, "_write_change", fake.write)
    allowlist_store.clear_cache()
    yield fake
    allowlist_store.clear_cache()
