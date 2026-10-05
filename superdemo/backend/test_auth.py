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

import pytest

from auth import is_email_allowed


@pytest.mark.parametrize(
    "email,domains,emails,expected",
    [
        ("alice@example.com", {"example.com"}, set(), True),       # domain match
        ("ALICE@Example.com", {"example.com"}, set(), True),        # case-insensitive
        ("bob@other.com", {"example.com"}, {"bob@other.com"}, True),  # exact email match
        ("eve@evil.com", {"example.com"}, {"bob@other.com"}, False),  # no match
        ("nobody@any.com", set(), set(), False),                    # both empty -> deny
        ("", {"example.com"}, set(), False),                        # empty email -> deny
    ],
)
def test_is_email_allowed(email, domains, emails, expected):
    assert is_email_allowed(email, domains, emails) is expected


from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from starlette.datastructures import Headers


def _request_with_auth(value: str | None):
    headers = {"authorization": value} if value is not None else {}
    req = MagicMock()
    req.headers = Headers(headers)
    return req


@patch.dict("os.environ", {"AUTH_ENABLED": "true"})
def test_get_current_user_missing_header():
    from auth import get_current_user

    with pytest.raises(HTTPException) as exc:
        get_current_user(_request_with_auth(None))
    assert exc.value.status_code == 401


@patch.dict("os.environ", {"AUTH_ENABLED": "true"})
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token", side_effect=ValueError("bad token"))
def test_get_current_user_invalid_token(_mock_verify, _ensure):
    from auth import get_current_user

    with pytest.raises(HTTPException) as exc:
        get_current_user(_request_with_auth("Bearer bad"))
    assert exc.value.status_code == 401


# ── Auth on/off toggle ────────────────────────────────────────────────
# AUTH_ENABLED wins when set; otherwise default on under Cloud Run (which
# always sets K_SERVICE) and off locally. clear=True so a stray K_SERVICE /
# AUTH_ENABLED in the test shell can't skew the defaults.


@patch.dict("os.environ", {}, clear=True)
def test_auth_enabled_defaults_off_locally():
    from auth import _auth_enabled

    assert _auth_enabled() is False


@patch.dict("os.environ", {"K_SERVICE": "superdemo-backend"}, clear=True)
def test_auth_enabled_defaults_on_cloud_run():
    from auth import _auth_enabled

    assert _auth_enabled() is True


@patch.dict("os.environ", {"K_SERVICE": "superdemo-backend", "AUTH_ENABLED": "false"}, clear=True)
def test_auth_enabled_explicit_off_overrides_cloud_run():
    from auth import _auth_enabled

    assert _auth_enabled() is False


@patch.dict("os.environ", {"AUTH_ENABLED": "true"}, clear=True)
def test_auth_enabled_explicit_on_locally():
    from auth import _auth_enabled

    assert _auth_enabled() is True


# ── Firestore-backed access ───────────────────────────────────────────

import logging

import allowlist_store

AUTH_ON = {"AUTH_ENABLED": "true"}


def _verified(email: str, uid: str = "uid-1", verified: bool = True) -> dict:
    return {"email": email, "email_verified": verified, "uid": uid}


@patch.dict("os.environ", AUTH_ON)
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_allowed_by_domain(mock_verify, _ensure, fake_allowlist):
    fake_allowlist.data["domains"] = ["example.com"]
    mock_verify.return_value = _verified("alice@example.com")
    from auth import get_current_user

    user = get_current_user(_request_with_auth("Bearer good-token"))
    assert user == {"email": "alice@example.com", "uid": "uid-1", "is_admin": False}
    mock_verify.assert_called_once_with("good-token")


@patch.dict("os.environ", AUTH_ON)
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_allowed_by_exact_email(mock_verify, _ensure, fake_allowlist):
    fake_allowlist.data["emails"] = ["bob@other.com"]
    mock_verify.return_value = _verified("bob@other.com")
    from auth import get_current_user

    assert get_current_user(_request_with_auth("Bearer t"))["is_admin"] is False


@patch.dict("os.environ", AUTH_ON)
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_admin_match_ignores_case(mock_verify, _ensure, fake_allowlist):
    fake_allowlist.data["admins"] = ["root@corp.com"]  # no emails/domains at all
    mock_verify.return_value = _verified("Root@Corp.com")
    from auth import get_current_user

    assert get_current_user(_request_with_auth("Bearer t"))["is_admin"] is True


@patch.dict("os.environ", AUTH_ON)
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_not_allowlisted_is_403_and_logged(mock_verify, _ensure, fake_allowlist, caplog):
    caplog.set_level(logging.INFO, logger="auth")
    fake_allowlist.data["domains"] = ["example.com"]
    mock_verify.return_value = _verified("eve@evil.com")
    from auth import get_current_user

    with pytest.raises(HTTPException) as exc:
        get_current_user(_request_with_auth("Bearer t"))
    assert exc.value.status_code == 403
    assert "access denied: eve@evil.com" in caplog.text


@patch.dict("os.environ", AUTH_ON)
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_all_lists_empty_denies(mock_verify, _ensure, fake_allowlist):
    mock_verify.return_value = _verified("anyone@any.com")
    from auth import get_current_user

    with pytest.raises(HTTPException) as exc:
        get_current_user(_request_with_auth("Bearer t"))
    assert exc.value.status_code == 403


@patch.dict("os.environ", AUTH_ON)
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_unverified_email_is_403(mock_verify, _ensure, fake_allowlist):
    fake_allowlist.data["domains"] = ["example.com"]
    mock_verify.return_value = _verified("alice@example.com", verified=False)
    from auth import get_current_user

    with pytest.raises(HTTPException) as exc:
        get_current_user(_request_with_auth("Bearer t"))
    assert exc.value.status_code == 403


@patch.dict("os.environ", AUTH_ON)
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_store_unavailable_is_503(mock_verify, _ensure, fake_allowlist):
    fake_allowlist.fail_reads = True
    mock_verify.return_value = _verified("alice@example.com")
    from auth import get_current_user

    with pytest.raises(HTTPException) as exc:
        get_current_user(_request_with_auth("Bearer t"))
    assert exc.value.status_code == 503
    assert exc.value.detail == "Allowlist store unavailable"


@patch.dict("os.environ", AUTH_ON)
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_admin_removed_loses_access(mock_verify, _ensure, fake_allowlist):
    fake_allowlist.data["admins"] = ["root@corp.com"]
    mock_verify.return_value = _verified("root@corp.com")
    from auth import get_current_user

    assert get_current_user(_request_with_auth("Bearer t"))["is_admin"] is True
    allowlist_store.remove_entry("admins", "root@corp.com", actor="root@corp.com")
    with pytest.raises(HTTPException) as exc:
        get_current_user(_request_with_auth("Bearer t"))
    assert exc.value.status_code == 403


@patch.dict("os.environ", AUTH_ON)
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token", side_effect=ValueError("bad token"))
def test_invalid_token_logs_warning_without_token(_mock_verify, _ensure, caplog):
    from auth import get_current_user

    with pytest.raises(HTTPException):
        get_current_user(_request_with_auth("Bearer secret-token-value"))
    assert "auth: token verification failed: ValueError" in caplog.text
    assert "secret-token-value" not in caplog.text


@patch.dict("os.environ", AUTH_ON)
def test_missing_header_is_not_logged(caplog):
    from auth import get_current_user

    with pytest.raises(HTTPException):
        get_current_user(_request_with_auth(None))
    assert "token verification failed" not in caplog.text


@patch.dict("os.environ", {"AUTH_ENABLED": "false"}, clear=True)
def test_disabled_returns_stub_admin_without_reading_store(fake_allowlist):
    from auth import get_current_user

    user = get_current_user(_request_with_auth(None))
    assert user == {"email": "local-dev@localhost", "uid": "local-dev", "is_admin": True}
    assert fake_allowlist.reads == 0


def test_get_admin_user_rejects_non_admin():
    from auth import get_admin_user

    with pytest.raises(HTTPException) as exc:
        get_admin_user({"email": "a@x.com", "uid": "u", "is_admin": False})
    assert exc.value.status_code == 403
    assert exc.value.detail == "Admin only"


def test_get_admin_user_passes_admin_through():
    from auth import get_admin_user

    user = {"email": "a@x.com", "uid": "u", "is_admin": True}
    assert get_admin_user(user) is user


def test_firebase_init_failure_is_logged(monkeypatch, caplog):
    import auth

    monkeypatch.setattr(auth, "_firebase_app", None)
    monkeypatch.setattr(
        auth.firebase_admin, "initialize_app", MagicMock(side_effect=ValueError("boom"))
    )
    with pytest.raises(ValueError):
        auth._ensure_firebase()
    assert "auth: Firebase app init failed" in caplog.text
