"""密碼雜湊（2026-10-16 起直接用 bcrypt，不再經 passlib）。

既有帳號的雜湊都是 passlib＋bcrypt 4.0 產生的；換掉 passlib 後必須照樣驗得過，
包括 72 bytes 以上的舊密碼（登入的既有密碼只限字元數，見 app/auth/schemas.py）。
下面的雜湊是換掉之前用 passlib 1.7.4＋bcrypt 4.0.1 實際產生的。"""

from __future__ import annotations

import pytest

from app.auth import service

PASSWORD = "correct horse battery staple"
LONG_PASSWORD = "密" * 30  # 90 bytes：bcrypt 只看前 72 bytes（前 24 個字）

PASSLIB_SHORT = "$2b$04$yApKYsdGA7tvRZD4bBaowOHUnIDY.aNMLFpuIOIX2Kd0t0fRNe/Qy"
PASSLIB_LONG = "$2b$04$KdThCnbb2bMrnh11Tm.n9OMXba3v4KoTdupmEiZtrsLpFGv9zDCgi"
PASSLIB_ROUNDS_12 = "$2b$12$XAiTfidvG01vSL1/HpGUF.RCMlQrUMIFxE2LqZ7KuFfdPBV.os3Ju"
PASSLIB_2A = "$2a$04$ZQLT41m9P3DPB9y0QHeZTepD0TmBdQetvAJMKLOBkL1SHF9hR8ixy"


@pytest.mark.parametrize("password_hash", [PASSLIB_SHORT, PASSLIB_ROUNDS_12, PASSLIB_2A])
def test_hashes_made_by_passlib_still_verify(password_hash):
    assert service._pwd_context.verify(PASSWORD, password_hash) is True
    assert service._pwd_context.verify(PASSWORD + "!", password_hash) is False


def test_long_legacy_password_verifies_like_passlib_did():
    # passlib 會截到 72 bytes 再比；bcrypt 5 遇到超過 72 bytes 會丟 ValueError，要自己截。
    assert service._pwd_context.verify(LONG_PASSWORD, PASSLIB_LONG) is True
    assert service._pwd_context.verify("密" * 24, PASSLIB_LONG) is True
    assert service._pwd_context.verify("密" * 23, PASSLIB_LONG) is False


def test_new_hashes_are_standard_bcrypt_with_configured_rounds():
    hashed = service.hash_password(PASSWORD)
    assert hashed.startswith(f"$2b${service._pwd_context.rounds:02d}$")
    assert service._pwd_context.verify(PASSWORD, hashed) is True
    assert service._pwd_context.verify("wrong password", hashed) is False


def test_production_rounds_default_is_12():
    assert type(service._pwd_context)().rounds == 12


def test_hashing_a_long_password_matches_verification():
    # 新密碼在 schema 就擋掉 72 bytes 以上；CLI 等不經 schema 的路徑照 passlib 的做法截斷，不丟例外。
    hashed = service.hash_password(LONG_PASSWORD)
    assert service._pwd_context.verify(LONG_PASSWORD, hashed) is True
    assert service._pwd_context.verify("密" * 24, hashed) is True


@pytest.mark.parametrize("bad_hash", ["", "not-a-hash", "$2b$04$short", "$argon2id$v=19$m=65536,t=3,p=4$abc$def"])
def test_unrecognised_hash_fails_closed(bad_hash):
    # passlib 遇到認不得的雜湊會丟 ValueError（登入 500）；改成驗證失敗。
    assert service._pwd_context.verify(PASSWORD, bad_hash) is False
