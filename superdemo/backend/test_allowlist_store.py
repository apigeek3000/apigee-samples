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

import google.auth
import google.auth.exceptions
import pytest

import allowlist_store
from allowlist_store import Allowlist, AllowlistUnavailable


def test_empty_document_gives_empty_lists(fake_allowlist):
    fake_allowlist.data = {}
    assert allowlist_store.get_allowlist() == Allowlist()


def test_reads_and_normalizes_stored_values(fake_allowlist):
    fake_allowlist.data = {
        "emails": ["Bob@X.com"],
        "domains": [" Example.COM "],
        "admins": ["Root@Corp.com"],
    }
    al = allowlist_store.get_allowlist()
    assert al.emails == {"bob@x.com"}
    assert al.domains == {"example.com"}
    assert al.admins == {"root@corp.com"}


def test_to_dict_is_sorted():
    al = Allowlist(emails=frozenset({"b@x.com", "a@x.com"}))
    assert al.to_dict() == {"emails": ["a@x.com", "b@x.com"], "domains": [], "admins": []}


def test_cache_serves_within_ttl_and_refreshes_after(fake_allowlist, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(allowlist_store, "_now", lambda: clock[0])
    allowlist_store.get_allowlist()
    clock[0] += 29
    allowlist_store.get_allowlist()
    assert fake_allowlist.reads == 1
    clock[0] += 2
    allowlist_store.get_allowlist()
    assert fake_allowlist.reads == 2


def test_add_entry_normalizes_and_writes(fake_allowlist):
    assert allowlist_store.add_entry("domains", "  Partner.COM ", actor="alice@corp.com") is True
    assert fake_allowlist.data["domains"] == ["partner.com"]


def test_add_entry_duplicate_returns_false_without_writing(fake_allowlist):
    fake_allowlist.data["emails"] = ["bob@x.com"]
    assert allowlist_store.add_entry("emails", "BOB@x.com", actor="alice@corp.com") is False
    assert fake_allowlist.writes == 0


def test_write_clears_cache(fake_allowlist):
    allowlist_store.get_allowlist()  # prime the cache with empty lists
    allowlist_store.add_entry("admins", "root@corp.com", actor="cli")
    assert "root@corp.com" in allowlist_store.get_allowlist().admins


def test_remove_entry(fake_allowlist):
    fake_allowlist.data["domains"] = ["partner.com"]
    assert allowlist_store.remove_entry("domains", "Partner.com", actor="alice@corp.com") is True
    assert fake_allowlist.data["domains"] == []


def test_remove_missing_returns_false(fake_allowlist):
    assert allowlist_store.remove_entry("emails", "nobody@x.com", actor="alice@corp.com") is False
    assert fake_allowlist.writes == 0


@pytest.mark.parametrize(
    "kind,value",
    [
        ("emails", "no-at-sign.com"),
        ("emails", "two@@x.com"),
        ("emails", "@x.com"),
        ("emails", "a@localhost"),
        ("emails", "a b@x.com"),
        ("admins", "not-an-email"),
        ("domains", "a@x.com"),
        ("domains", "nodot"),
        ("domains", "bad_char.com"),
        ("domains", ""),
    ],
)
def test_normalize_rejects_invalid(kind, value):
    with pytest.raises(ValueError):
        allowlist_store.normalize(kind, value)


def test_normalize_rejects_unknown_kind():
    with pytest.raises(ValueError):
        allowlist_store.normalize("groups", "x.com")


def test_add_logs_one_info_line(fake_allowlist, caplog):
    caplog.set_level(logging.INFO, logger="allowlist_store")
    allowlist_store.add_entry("domains", "partner.com", actor="alice@corp.com")
    assert "allowlist: alice@corp.com added domain partner.com" in caplog.text


def test_remove_logs_one_info_line(fake_allowlist, caplog):
    caplog.set_level(logging.INFO, logger="allowlist_store")
    fake_allowlist.data["admins"] = ["bob@corp.com"]
    allowlist_store.remove_entry("admins", "bob@corp.com", actor="alice@corp.com")
    assert "allowlist: alice@corp.com removed admin bob@corp.com" in caplog.text


def test_read_failure_raises_and_logs_error(fake_allowlist, caplog):
    fake_allowlist.fail_reads = True
    with pytest.raises(AllowlistUnavailable):
        allowlist_store.get_allowlist()
    assert "allowlist: Firestore read failed: RuntimeError: firestore down" in caplog.text


def test_write_failure_raises_and_logs_error_with_trace(fake_allowlist, caplog):
    fake_allowlist.fail_writes = True
    with pytest.raises(AllowlistUnavailable):
        allowlist_store.add_entry("domains", "new.com", actor="alice@corp.com")
    records = [r for r in caplog.records if "failed to add" in r.getMessage()]
    assert len(records) == 1
    assert records[0].levelno == logging.ERROR
    assert records[0].exc_info is not None
    assert (
        "allowlist: alice@corp.com failed to add domain new.com: RuntimeError: firestore down"
        in records[0].getMessage()
    )


def test_client_init_without_project_logs_fix(monkeypatch, caplog):
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.setattr(allowlist_store, "_client", None)

    def no_adc(*args, **kwargs):
        raise google.auth.exceptions.DefaultCredentialsError("no adc")

    monkeypatch.setattr(google.auth, "default", no_adc)
    with pytest.raises(AllowlistUnavailable):
        allowlist_store._get_client()
    assert "gcloud auth application-default login" in caplog.text


def test_client_uses_superdemo_database(monkeypatch):
    from google.cloud import firestore

    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
    monkeypatch.setattr(allowlist_store, "_client", None)
    calls = []
    monkeypatch.setattr(firestore, "Client", lambda **kwargs: calls.append(kwargs) or object())
    allowlist_store._get_client()
    # Must match google_firestore_database.superdemo in superdemo/terraform.
    assert calls == [{"project": "proj", "database": "superdemo"}]


def test_cli_add_admin(fake_allowlist, capsys):
    fake_allowlist.data = {}
    assert allowlist_store._main(["add-admin", "Me@Corp.com"]) == 0
    assert fake_allowlist.data["admins"] == ["me@corp.com"]
    assert "me@corp.com added as admin" in capsys.readouterr().out


def test_cli_add_admin_already_present(fake_allowlist, capsys):
    fake_allowlist.data["admins"] = ["me@corp.com"]
    assert allowlist_store._main(["add-admin", "me@corp.com"]) == 0
    assert "me@corp.com is already an admin" in capsys.readouterr().out


def test_cli_add_admin_invalid(capsys):
    assert allowlist_store._main(["add-admin", "nope"]) == 2
    assert "Not a valid email" in capsys.readouterr().err


def test_cli_list(fake_allowlist, capsys):
    fake_allowlist.data["admins"] = ["me@corp.com"]
    assert allowlist_store._main(["list"]) == 0
    out = capsys.readouterr().out
    assert "admins: me@corp.com" in out
    assert "domains: (none)" in out


def test_cli_usage(capsys):
    assert allowlist_store._main([]) == 2
    assert "usage:" in capsys.readouterr().err
