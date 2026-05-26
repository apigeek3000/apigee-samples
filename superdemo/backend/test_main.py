# Copyright 2025 Google LLC
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

import os
from unittest.mock import patch

import google.auth.exceptions
from fastapi.testclient import TestClient

# Ensure no project is set during testing so the config falls back gracefully
os.environ.pop("GOOGLE_CLOUD_PROJECT", None)

# Force ADC discovery to fail so tests don't depend on the developer's gcloud state.
_adc_patch = patch(
    "google.auth.default",
    side_effect=google.auth.exceptions.DefaultCredentialsError("disabled in tests"),
)
_adc_patch.start()

from main import app  # noqa: E402

client = TestClient(app)


def test_list_demos_unconfigured():
    """Without GOOGLE_CLOUD_PROJECT the backend reports unconfigured."""
    response = client.get("/api/demos")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "unconfigured"
    assert len(data["demos"]) == 2


def test_list_demos_returns_metadata():
    """Check that demo metadata is always present."""
    response = client.get("/api/demos")
    data = response.json()
    ids = [d["id"] for d in data["demos"]]
    assert "basic-quota" in ids
    assert "llm-security" in ids


def test_proxy_unknown_demo():
    """Requesting a non-existent demo should 500 (config unavailable) or 404."""
    response = client.get("/api/proxy/nonexistent/test")
    # Without config, it will raise 500 before hitting the 404 check
    assert response.status_code in (404, 500)
