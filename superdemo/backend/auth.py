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

"""Firebase ID-token verification and Firestore allowlist for the superdemo backend.

Who may sign in, and who is an admin, lives in Firestore (see
allowlist_store.py). Auth is enforced when enabled (see `_auth_enabled`): on by
default under Cloud Run, off by default in local development, where a stub
admin user is returned. Tests bypass it via
`app.dependency_overrides[get_current_user]` (see conftest.py) — the real
verification path still ships and runs outside tests.
"""


def is_email_allowed(email: str, domains: set[str], emails: set[str]) -> bool:
    """True if `email` is on the allowlist.

    Allowed when the exact address is in `emails`, OR its domain is in
    `domains`. All comparisons are case-insensitive. Fail closed: an empty
    email, or both allowlists empty, denies.
    """
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return False
    if email in {e.strip().lower() for e in emails}:
        return True
    domain = email.rsplit("@", 1)[1]
    return domain in {d.strip().lower() for d in domains}


import logging
import os

import firebase_admin
from firebase_admin import auth as firebase_auth
from fastapi import Depends, HTTPException, Request

import allowlist_store

logger = logging.getLogger(__name__)

# Lazy Firebase app handle (matches the lazy-init pattern in main.py for the
# logging client / Vertex credentials). Importing this module has no side
# effects, so tests can import it without touching the network or ADC.
_firebase_app = None


def _ensure_firebase() -> None:
    """Initialise the firebase-admin app once, via ADC. Project id comes from
    FIREBASE_PROJECT_ID, falling back to GOOGLE_CLOUD_PROJECT."""
    global _firebase_app
    if _firebase_app is not None:
        return
    project_id = os.environ.get("FIREBASE_PROJECT_ID") or os.environ.get(
        "GOOGLE_CLOUD_PROJECT"
    )
    options = {"projectId": project_id} if project_id else None
    try:
        _firebase_app = firebase_admin.initialize_app(options=options)
    except Exception:
        logger.exception("auth: Firebase app init failed")
        raise


def _auth_enabled() -> bool:
    """Whether to enforce auth on this request.

    An explicit AUTH_ENABLED env var wins (truthy: 1/true/yes/on). Otherwise the
    default is on when running on Cloud Run — which always sets K_SERVICE — and
    off in local development, so the dev loop needs no Firebase config or
    sign-in.
    """
    explicit = os.environ.get("AUTH_ENABLED", "").strip()
    if explicit:
        return explicit.lower() in {"1", "true", "yes", "on"}
    return bool(os.environ.get("K_SERVICE"))


def get_current_user(request: Request) -> dict:
    """FastAPI dependency: verify the Firebase ID token and enforce the allowlist.

    401 — missing/malformed/invalid token. 403 — unverified email or not on the
    allowlist. 503 — the Firestore allowlist couldn't be read. When auth is
    disabled (local dev by default), it short-circuits to a stub admin user.
    """
    if not _auth_enabled():
        return {"email": "local-dev@localhost", "uid": "local-dev", "is_admin": True}

    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = header[len("bearer "):].strip()

    _ensure_firebase()
    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception as e:  # firebase raises several subclasses; treat all as 401
        logger.warning("auth: token verification failed: %s", type(e).__name__)
        raise HTTPException(status_code=401, detail="Invalid token") from e

    if not decoded.get("email_verified"):
        raise HTTPException(status_code=403, detail="Email not verified")

    email = decoded.get("email", "")
    try:
        allowlist = allowlist_store.get_allowlist()
    except allowlist_store.AllowlistUnavailable as e:
        raise HTTPException(status_code=503, detail="Allowlist store unavailable") from e

    if not is_email_allowed(
        email, set(allowlist.domains), set(allowlist.emails | allowlist.admins)
    ):
        logger.info("access denied: %s", email)
        raise HTTPException(status_code=403, detail="Not authorized")

    is_admin = email.strip().lower() in allowlist.admins
    return {"email": email, "uid": decoded.get("uid", ""), "is_admin": is_admin}


def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency: like get_current_user, but 403 unless an admin."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user
