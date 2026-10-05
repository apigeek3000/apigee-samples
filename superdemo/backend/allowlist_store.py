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

"""Firestore-backed access allowlist for the superdemo backend.

One document (superdemo/allowlist in the project's (default) database) holds
three lists: `emails` and `domains` (who may sign in) and `admins` (who may
sign in AND manage the lists on the Users page). Reads are cached per process
for 30 seconds; writes clear the cache.

Also a tiny CLI for bootstrapping the first admin:

    uv run python -m allowlist_store add-admin you@example.com
    uv run python -m allowlist_store list
"""

import logging
import os
import re
import sys
import time
from dataclasses import dataclass

import google.auth
import google.auth.exceptions

logger = logging.getLogger(__name__)

KINDS = ("emails", "domains", "admins")
_LABELS = {"emails": "email", "domains": "domain", "admins": "admin"}
_COLLECTION = "superdemo"
_DOCUMENT = "allowlist"
_CACHE_TTL_SECONDS = 30.0
_DOMAIN_RE = re.compile(r"^[a-z0-9.-]+$")


class AllowlistUnavailable(Exception):
    """Firestore could not be reached, read or written."""


@dataclass(frozen=True)
class Allowlist:
    emails: frozenset[str] = frozenset()
    domains: frozenset[str] = frozenset()
    admins: frozenset[str] = frozenset()

    def to_dict(self) -> dict[str, list[str]]:
        return {kind: sorted(getattr(self, kind)) for kind in KINDS}


def normalize(kind: str, value: str) -> str:
    """Trim + lowercase `value` and validate it for `kind`. Raises ValueError."""
    if kind not in KINDS:
        raise ValueError(f"Unknown list: {kind!r}")
    v = (value or "").strip().lower()
    if kind == "domains":
        if "@" in v or "." not in v or not _DOMAIN_RE.match(v):
            raise ValueError(f"Not a valid domain: {value!r}")
        return v
    local, _, domain = v.partition("@")
    if v.count("@") != 1 or not local or "." not in domain or any(c.isspace() for c in v):
        raise ValueError(f"Not a valid email: {value!r}")
    return v


# ── Firestore access (lazy; tests replace _read_doc / _write_change) ──
_client = None
_cache: Allowlist | None = None
_cache_at = 0.0
_now = time.monotonic


def _get_client():
    """Return a cached Firestore client, created via ADC on first use."""
    global _client
    if _client is not None:
        return _client
    project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project_id:
        try:
            _, project_id = google.auth.default()
        except google.auth.exceptions.DefaultCredentialsError:
            project_id = None
    if not project_id:
        logger.error(
            "allowlist: no GCP project found. Set GOOGLE_CLOUD_PROJECT or run "
            "`gcloud auth application-default login` followed by "
            "`gcloud auth application-default set-quota-project <project>`."
        )
        raise AllowlistUnavailable("no GCP project")
    try:
        from google.cloud import firestore

        _client = firestore.Client(project=project_id)
    except Exception as e:
        logger.error("allowlist: Firestore client init failed: %s: %s", type(e).__name__, e)
        raise AllowlistUnavailable(str(e)) from e
    return _client


def _doc_ref():
    return _get_client().collection(_COLLECTION).document(_DOCUMENT)


def _read_doc() -> dict:
    snapshot = _doc_ref().get()
    return (snapshot.to_dict() or {}) if snapshot.exists else {}


def _write_change(kind: str, value: str, add: bool, actor: str) -> None:
    from google.cloud import firestore

    change = firestore.ArrayUnion([value]) if add else firestore.ArrayRemove([value])
    _doc_ref().set(
        {kind: change, "updated_at": firestore.SERVER_TIMESTAMP, "updated_by": actor},
        merge=True,
    )


# ── Public API ────────────────────────────────────────────────────────
def clear_cache() -> None:
    global _cache
    _cache = None


def get_allowlist() -> Allowlist:
    """Return the allowlist, from cache if younger than 30s."""
    global _cache, _cache_at
    now = _now()
    if _cache is not None and now - _cache_at < _CACHE_TTL_SECONDS:
        return _cache
    try:
        data = _read_doc()
    except AllowlistUnavailable:
        raise
    except Exception as e:
        logger.error("allowlist: Firestore read failed: %s: %s", type(e).__name__, e)
        raise AllowlistUnavailable(str(e)) from e
    _cache = Allowlist(
        **{
            kind: frozenset(str(v).strip().lower() for v in (data.get(kind) or []))
            for kind in KINDS
        }
    )
    _cache_at = now
    return _cache


def _apply(kind: str, value: str, add: bool, actor: str) -> None:
    verb = "add" if add else "remove"
    try:
        _write_change(kind, value, add=add, actor=actor)
    except AllowlistUnavailable:
        raise
    except Exception as e:
        logger.exception(
            "allowlist: %s failed to %s %s %s: %s: %s",
            actor, verb, _LABELS[kind], value, type(e).__name__, e,
        )
        raise AllowlistUnavailable(str(e)) from e
    clear_cache()
    logger.info("allowlist: %s %s %s %s", actor, "added" if add else "removed", _LABELS[kind], value)


def add_entry(kind: str, value: str, actor: str) -> bool:
    """Add `value` to `kind`. Returns False (no write) if it's already there."""
    value = normalize(kind, value)
    clear_cache()  # decide against fresh data, not a 30s-old copy
    if value in getattr(get_allowlist(), kind):
        return False
    _apply(kind, value, add=True, actor=actor)
    return True


def remove_entry(kind: str, value: str, actor: str) -> bool:
    """Remove `value` from `kind`. Returns False (no write) if it isn't there.

    Not validated beyond trim+lowercase, so a malformed hand-edited entry can
    still be removed.
    """
    if kind not in KINDS:
        raise ValueError(f"Unknown list: {kind!r}")
    value = (value or "").strip().lower()
    clear_cache()
    if value not in getattr(get_allowlist(), kind):
        return False
    _apply(kind, value, add=False, actor=actor)
    return True


# ── CLI ───────────────────────────────────────────────────────────────
_USAGE = "usage: python -m allowlist_store add-admin <email> | list"


def _main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "add-admin":
        try:
            added = add_entry("admins", argv[1], actor="cli")
        except ValueError as e:
            print(e, file=sys.stderr)
            return 2
        except AllowlistUnavailable:
            return 1  # already logged
        email = argv[1].strip().lower()
        print(f"{email} added as admin" if added else f"{email} is already an admin")
        return 0
    if argv == ["list"]:
        try:
            allowlist = get_allowlist()
        except AllowlistUnavailable:
            return 1
        for kind, values in allowlist.to_dict().items():
            print(f"{kind}: {', '.join(values) or '(none)'}")
        return 0
    print(_USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sys.exit(_main(sys.argv[1:]))
