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
verification code still ships.
"""

import pytest

from main import app
from auth import get_current_user


@pytest.fixture(autouse=True)
def _override_auth():
    app.dependency_overrides[get_current_user] = lambda: {
        "email": "tester@example.com",
        "uid": "test-uid",
    }
    yield
    app.dependency_overrides.pop(get_current_user, None)
