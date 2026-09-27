"""Password hashing with the standard library's scrypt.

A password is not a token: it is short, human-chosen and reused across sites, so it must be slow to
test. `hashlib.scrypt` is memory-hard, ships with Python and needs no wheel, which matters on a 512 MB
instance where every dependency is weight. The previous PIN scheme was a single HMAC-SHA256 pass, fast
enough to try billions of guesses a second against a stolen database; this is not.

Stored form: scrypt$n$r$p$salt_b64$hash_b64, so the cost can be raised later without invalidating
anybody's password: the parameters travel with each hash.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

# 32 MB and about 40 ms per hash here. OWASP wants more, but the free instance has 512 MB in total
# and must still serve bills while somebody logs in. Raise N, not r or p, when the instance grows:
# old hashes keep working because their parameters are stored with them, and login upgrades them.
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16
KEY_LEN = 32
MIN_PASSWORD_LENGTH = 8


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str, *, n: int = SCRYPT_N, r: int = SCRYPT_R, p: int = SCRYPT_P) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    key = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=KEY_LEN, maxmem=64 * 1024 * 1024)
    return f"scrypt${n}${r}${p}${_b64(salt)}${_b64(key)}"


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time check. A malformed or missing hash is a failure, never an exception."""
    if not stored:
        return False
    try:
        scheme, n_s, r_s, p_s, salt_s, hash_s = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = _unb64(hash_s)
        actual = hashlib.scrypt(password.encode(), salt=_unb64(salt_s), n=int(n_s), r=int(r_s), p=int(p_s),
                                dklen=len(expected), maxmem=64 * 1024 * 1024)
    except Exception:  # noqa: BLE001
        return False
    return hmac.compare_digest(actual, expected)


def needs_rehash(stored: str | None) -> bool:
    """True when a stored hash was made with weaker parameters than today's, so login can upgrade it."""
    if not stored:
        return True
    try:
        scheme, n_s, r_s, p_s, _, _ = stored.split("$")
    except ValueError:
        return True
    return scheme != "scrypt" or (int(n_s), int(r_s), int(p_s)) != (SCRYPT_N, SCRYPT_R, SCRYPT_P)
