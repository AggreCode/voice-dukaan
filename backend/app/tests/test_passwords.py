"""Password storage. No database needed: this is the part that must be right on its own."""
from __future__ import annotations

import time

import pytest

from app.services import sessions as session_svc
from app.services.passwords import (
    MIN_PASSWORD_LENGTH,
    hash_password,
    needs_rehash,
    verify_password,
)


def test_a_password_is_never_stored_and_never_repeats():
    secret = "chai pe charcha"
    a, b = hash_password(secret), hash_password(secret)
    assert secret not in a and secret not in b
    assert a != b, "each hash needs its own salt, or identical passwords look identical in the table"
    assert a.startswith("scrypt$")
    assert verify_password(secret, a) and verify_password(secret, b)


def test_a_wrong_password_fails_and_a_broken_hash_does_not_explode():
    stored = hash_password("correct")
    assert not verify_password("Correct", stored)  # case matters
    assert not verify_password("", stored)
    for junk in (None, "", "junk", "scrypt$x$y$z", "sha256$deadbeef", "scrypt$1$2$3$4$5"):
        assert not verify_password("correct", junk)


def test_hashing_is_slow_enough_to_be_worth_something():
    """Not a benchmark, a floor: a hash a modern machine does in microseconds is no protection."""
    stored = hash_password("some password")
    t0 = time.perf_counter()
    verify_password("some password", stored)
    ms = (time.perf_counter() - t0) * 1000
    assert ms > 5, f"verify took {ms:.1f} ms, which is too fast to slow an attacker down"


def test_parameters_travel_with_the_hash_so_the_cost_can_be_raised_later():
    weak = hash_password("pw", n=2**12)
    assert verify_password("pw", weak), "an old hash must keep working"
    assert needs_rehash(weak), "but login should notice and upgrade it"
    assert not needs_rehash(hash_password("pw"))


def test_the_minimum_length_is_stated_once_and_is_not_silly():
    assert MIN_PASSWORD_LENGTH >= 8


def test_a_session_token_is_random_and_what_is_stored_is_not_the_token():
    from app.config import get_settings

    get_settings().APP_SECRET = "test-secret"
    tokens = {session_svc.new_token() for _ in range(200)}
    assert len(tokens) == 200, "session tokens must not repeat"
    token = tokens.pop()
    assert len(token) >= 32
    stored = session_svc.token_hash(token)
    assert token not in stored
    assert stored == session_svc.token_hash(token), "hashing must be stable"
    assert stored != session_svc.token_hash(session_svc.new_token())


@pytest.mark.parametrize("secret", ["one", "two"])
def test_the_stored_hash_depends_on_the_application_secret(secret):
    """A leaked sessions table is useless without APP_SECRET."""
    from app.config import get_settings

    s = get_settings()
    token = "a-fixed-token"
    s.APP_SECRET = secret
    got = session_svc.token_hash(token)
    s.APP_SECRET = secret + "-different"
    assert got != session_svc.token_hash(token)
