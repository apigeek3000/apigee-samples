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

import logging

import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from main import app

client = TestClient(app)


@pytest.fixture
def as_non_admin():
    # conftest's autouse _override_auth pops this key at teardown.
    app.dependency_overrides[get_current_user] = lambda: {
        "email": "user@example.com",
        "uid": "u2",
        "is_admin": False,
    }


def test_me_returns_email_and_admin_flag():
    resp = client.get("/api/me")
    assert resp.status_code == 200
    assert resp.json() == {"email": "tester@example.com", "is_admin": True}


def test_me_for_non_admin(as_non_admin):
    assert client.get("/api/me").json() == {"email": "user@example.com", "is_admin": False}


@pytest.mark.parametrize(
    "method,url,body",
    [
        ("GET", "/api/admin/allowlist", None),
        ("POST", "/api/admin/allowlist/domains", {"value": "x.com"}),
        ("DELETE", "/api/admin/allowlist/domains/x.com", None),
    ],
)
def test_admin_routes_forbidden_for_non_admin(as_non_admin, method, url, body):
    resp = client.request(method, url, json=body)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin only"


def test_get_allowlist_is_sorted(fake_allowlist):
    fake_allowlist.data = {"emails": ["b@x.com", "a@x.com"], "domains": ["corp.com"], "admins": []}
    resp = client.get("/api/admin/allowlist")
    assert resp.status_code == 200
    assert resp.json() == {"emails": ["a@x.com", "b@x.com"], "domains": ["corp.com"], "admins": []}


def test_add_entry_returns_201_list_and_logs(fake_allowlist, caplog):
    caplog.set_level(logging.INFO, logger="allowlist_store")
    resp = client.post("/api/admin/allowlist/domains", json={"value": "Partner.com"})
    assert resp.status_code == 201
    assert resp.json()["domains"] == ["partner.com"]
    assert "allowlist: tester@example.com added domain partner.com" in caplog.text


def test_add_duplicate_returns_200(fake_allowlist):
    fake_allowlist.data["admins"] = ["root@corp.com"]
    resp = client.post("/api/admin/allowlist/admins", json={"value": "root@corp.com"})
    assert resp.status_code == 200
    assert resp.json()["admins"] == ["root@corp.com"]
    assert fake_allowlist.writes == 0


def test_add_invalid_returns_422():
    resp = client.post("/api/admin/allowlist/domains", json={"value": "nodot"})
    assert resp.status_code == 422
    assert "Not a valid domain" in resp.json()["detail"]


@pytest.mark.parametrize(
    "method,url,body",
    [
        ("POST", "/api/admin/allowlist/groups", {"value": "x.com"}),
        ("DELETE", "/api/admin/allowlist/groups/x.com", None),
    ],
)
def test_unknown_kind_returns_404(method, url, body):
    assert client.request(method, url, json=body).status_code == 404


def test_remove_entry_returns_200_list(fake_allowlist):
    fake_allowlist.data["domains"] = ["corp.com", "partner.com"]
    resp = client.delete("/api/admin/allowlist/domains/partner.com")
    assert resp.status_code == 200
    assert resp.json()["domains"] == ["corp.com"]


def test_remove_missing_returns_404():
    assert client.delete("/api/admin/allowlist/emails/nobody@x.com").status_code == 404


def test_remove_email_with_plus_and_at(fake_allowlist):
    fake_allowlist.data["emails"] = ["a+b@x.com"]
    resp = client.delete("/api/admin/allowlist/emails/a%2Bb%40x.com")
    assert resp.status_code == 200
    assert resp.json()["emails"] == []


def test_write_failure_returns_503(fake_allowlist):
    fake_allowlist.fail_writes = True
    resp = client.post("/api/admin/allowlist/domains", json={"value": "partner.com"})
    assert resp.status_code == 503
    assert resp.json()["detail"] == "Allowlist store unavailable"


def test_read_failure_returns_503(fake_allowlist):
    fake_allowlist.fail_reads = True
    resp = client.get("/api/admin/allowlist")
    assert resp.status_code == 503
    assert resp.json()["detail"] == "Allowlist store unavailable"
