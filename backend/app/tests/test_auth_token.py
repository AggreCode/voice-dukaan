"""The regression that made the hosted app unusable: tokens were signed with the AI keys, so adding or
rotating a key invalidated every issued token and every request answered "invalid or expired token".
"""
from __future__ import annotations

import time
import uuid

from app.api import deps
from app.config import get_settings


def _fresh(**over):
    """A settings object the whole module shares, since deps reads get_settings() on every call."""
    s = get_settings()
    for k, v in over.items():
        setattr(s, k, v)
    return s


def test_a_token_survives_an_api_key_being_added_or_rotated():
    s = _fresh(APP_SECRET="a-generated-secret", ANTHROPIC_API_KEY="", SARVAM_API_KEY="sk-one")
    token = deps.make_token(uuid.uuid4(), uuid.uuid4())
    assert deps.parse_token(token) is not None

    s.ANTHROPIC_API_KEY = "sk-ant-added-later"  # what Render does the day a key is pasted in
    s.SARVAM_API_KEY = "sk-rotated"
    assert deps.parse_token(token) is not None, "token must not depend on the AI keys"


def test_without_app_secret_the_old_behaviour_is_reproduced():
    """Kept as a statement of the bug: this is exactly what the deployment was doing."""
    s = _fresh(APP_SECRET="", ANTHROPIC_API_KEY="", SARVAM_API_KEY="sk-one")
    token = deps.make_token(uuid.uuid4(), uuid.uuid4())
    assert deps.parse_token(token) is not None
    s.ANTHROPIC_API_KEY = "sk-ant-added-later"
    assert deps.parse_token(token) is None


def test_a_token_from_a_different_secret_is_rejected():
    s = _fresh(APP_SECRET="secret-one")
    token = deps.make_token(uuid.uuid4(), uuid.uuid4())
    s.APP_SECRET = "secret-two"
    assert deps.parse_token(token) is None


def test_a_signature_containing_the_separator_byte_still_verifies():
    """The old format base64-encoded payload + b"." + signature as one blob, so a signature containing
    the byte 0x2e was split through the middle and the token was rejected. About 11% of all tokens."""
    _fresh(APP_SECRET="secret-one")
    found = None
    for i in range(5000):  # deterministic search for a signature that contains the separator byte
        shop, user = uuid.UUID(int=i), uuid.UUID(int=1)
        token = deps.make_token(shop, user)
        sig = deps._b64d(token.split(".")[1])
        if b"." in sig:
            found = (token, shop)
            break
    assert found is not None, "expected some signature to contain 0x2e"
    token, shop = found
    assert deps.parse_token(token) is not None
    assert deps.parse_token(token)["s"] == str(shop)


def test_every_minted_token_parses():
    """No flakiness: 500 tokens, 500 successful parses."""
    _fresh(APP_SECRET="secret-one")
    for i in range(500):
        assert deps.parse_token(deps.make_token(uuid.UUID(int=i), uuid.uuid4())) is not None


def test_tampering_and_expiry_are_rejected():
    _fresh(APP_SECRET="secret-one")
    shop, user = uuid.uuid4(), uuid.uuid4()
    token = deps.make_token(shop, user)
    assert deps.parse_token(token)["s"] == str(shop)
    assert deps.parse_token(token[:-2] + ("aa" if not token.endswith("aa") else "bb")) is None
    assert deps.parse_token("not-a-token") is None  # no separator at all
    assert deps.parse_token("") is None

    original = deps.TOKEN_TTL_S
    try:
        deps.TOKEN_TTL_S = -1
        assert deps.parse_token(deps.make_token(shop, user)) is None
    finally:
        deps.TOKEN_TTL_S = original
    assert int(time.time()) > 0


def test_a_pin_set_under_the_old_secret_still_verifies_once():
    """A shop that set a PIN before APP_SECRET existed must be able to log in, and login re-hashes it."""
    s = _fresh(APP_SECRET="", ANTHROPIC_API_KEY="", SARVAM_API_KEY="sk-one")
    stored_legacy = deps.hash_pin("1234")
    s.APP_SECRET = "a-generated-secret"
    assert deps.hash_pin("1234") != stored_legacy
    assert deps.hash_pin_legacy("1234") == stored_legacy
    assert deps.hash_pin_legacy("9999") != stored_legacy
