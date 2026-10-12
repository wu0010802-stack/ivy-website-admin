from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, ValidationError, field_validator
from pydantic_core import InitErrorDetails, PydanticCustomError

MAX_PHRASES = 20
MAX_PHRASE_LENGTH = 60

# 比對 javascript: 前先清掉不可見字元與空白：瀏覽器解析 scheme 時會忽略內嵌的
# TAB／換行，`java<TAB>script:` 一樣會執行（見 content/schemas.py 的說明）。
_INVISIBLE_RE = re.compile(r"[\x00-\x20\x7f\u00ad\u200b-\u200f\u2028\u2029\ufeff]")
# Cc 控制字元（含換行、TAB、NUL、ESC）、Cf 格式字元（零寬空白、雙向控制）、
# Zl／Zp 行與段落分隔符：片語是單行純文字，這些都不該出現。
_FORBIDDEN_CATEGORIES = {"Cc", "Cf", "Zl", "Zp"}


def _strip(value):
    return value.strip() if isinstance(value, str) else value


def _single_line_text(value: str) -> str:
    if any(unicodedata.category(char) in _FORBIDDEN_CATEGORIES for char in value):
        raise ValueError("片語不可含換行或控制字元")
    return value


def _reject_javascript_scheme(value: str) -> str:
    # 片語只會當純文字帶進輸入框，不會變成連結；仍然擋掉，避免日後被誤當連結使用。
    if "javascript:" in _INVISIBLE_RE.sub("", value).lower():
        raise ValueError("片語不可含 javascript:")
    return value


# 先 strip 再檢查長度，所以「前後空白」不算字數，全空白視為空字串。
Phrase = Annotated[
    str,
    BeforeValidator(_strip),
    Field(min_length=1, max_length=MAX_PHRASE_LENGTH),
    AfterValidator(_single_line_text),
    AfterValidator(_reject_javascript_scheme),
]


class ContactPhrasesOut(BaseModel):
    phrases: list[str]
    version: int
    # 還沒有人編輯過（預設片語）時為 None。
    updated_at: datetime | None = None
    updated_by_name: str | None = None


class ContactPhrasesUpdate(BaseModel):
    phrases: Annotated[list[Phrase], Field(max_length=MAX_PHRASES)]
    # 畫面載入時的 version；不符回 409 CONTACT_PHRASES_VERSION_CONFLICT。
    expected_version: int = Field(ge=1)

    @field_validator("phrases")
    @classmethod
    def _no_duplicates(cls, phrases: list[str]) -> list[str]:
        seen: dict[str, int] = {}
        errors: list[InitErrorDetails] = []
        for index, phrase in enumerate(phrases):
            if phrase in seen:
                errors.append(
                    InitErrorDetails(
                        type=PydanticCustomError(
                            "duplicate_phrase", "第 {number} 句和第 {first} 句重複", {"number": index + 1, "first": seen[phrase] + 1}
                        ),
                        loc=(index,),
                        input=phrase,
                    )
                )
            else:
                seen[phrase] = index
        if errors:
            # 帶著位置丟出去，422 的 loc 會是 phrases.<第幾句>，後台能標在那一句上。
            raise ValidationError.from_exception_data("ContactPhrasesUpdate", errors)
        return phrases
