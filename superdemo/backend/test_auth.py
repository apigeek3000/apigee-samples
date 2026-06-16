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


@patch.dict("os.environ", {"AUTH_ENABLED": "true", "ALLOWED_DOMAINS": "example.com", "ALLOWED_EMAILS": ""})
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_get_current_user_allowed(mock_verify, _ensure):
    mock_verify.return_value = {
        "email": "alice@example.com",
        "email_verified": True,
        "uid": "uid-1",
    }
    from auth import get_current_user

    user = get_current_user(_request_with_auth("Bearer good-token"))
    assert user == {"email": "alice@example.com", "uid": "uid-1"}
    mock_verify.assert_called_once_with("good-token")


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


@patch.dict("os.environ", {"AUTH_ENABLED": "true", "ALLOWED_DOMAINS": "example.com", "ALLOWED_EMAILS": ""})
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_get_current_user_unverified_email(mock_verify, _ensure):
    mock_verify.return_value = {
        "email": "alice@example.com",
        "email_verified": False,
        "uid": "uid-1",
    }
    from auth import get_current_user

    with pytest.raises(HTTPException) as exc:
        get_current_user(_request_with_auth("Bearer good"))
    assert exc.value.status_code == 403


@patch.dict("os.environ", {"AUTH_ENABLED": "true", "ALLOWED_DOMAINS": "example.com", "ALLOWED_EMAILS": ""})
@patch("auth._ensure_firebase")
@patch("auth.firebase_auth.verify_id_token")
def test_get_current_user_not_allowlisted(mock_verify, _ensure):
    mock_verify.return_value = {
        "email": "eve@evil.com",
        "email_verified": True,
        "uid": "uid-2",
    }
    from auth import get_current_user

    with pytest.raises(HTTPException) as exc:
        get_current_user(_request_with_auth("Bearer good"))
    assert exc.value.status_code == 403


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


@patch.dict("os.environ", {"AUTH_ENABLED": "false"}, clear=True)
def test_get_current_user_bypassed_when_disabled():
    """With auth disabled, no token is required — a stub local user is returned."""
    from auth import get_current_user

    user = get_current_user(_request_with_auth(None))
    assert user == {"email": "local-dev@localhost", "uid": "local-dev"}
