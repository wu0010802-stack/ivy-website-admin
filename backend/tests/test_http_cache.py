"""If-None-Match 比對（app/common/http_cache.py）。"""

from __future__ import annotations

import pytest

from app.common.http_cache import etag_matches

ETAG = '"villages-115-08-17-0123456789ab"'


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (ETAG, True),
        (f"W/{ETAG}", True),
        (f'"other", {ETAG}', True),
        (f'"other",W/{ETAG} ,"third"', True),
        ("*", True),
        (' * ', True),
        ('"other"', False),
        (f"{ETAG}x", False),
        (f'"x{ETAG[1:]}', False),
        ("", False),
        (None, False),
        ("W/", False),
        (",", False),
    ],
)
def test_etag_matches(header, expected):
    assert etag_matches(header, ETAG) is expected
