"""整頁內容：特色教學頁（curriculum_page）與關於常春藤頁（about_page）。

2026-10-03 使用者裁定「文字與照片都開放」：標題、內文、照片都能在後台改，章節
數量、順序與版面結構固定（水彩版的錯落排法、立體書的卡紙位置都照項目數排好，
多一項少一項就跑版），所以清單一律「恰好幾項」、項目代號固定。

字數兩層：這裡是擋存檔的硬上限（超過版面會壞，scripts/page-copy-stress.cjs 實測），
後台 composables/contentHints.ts 是只提醒的建議值。上限表見 DESIGN.md「特色教學頁、
關於常春藤頁開放後台編輯」，改上限要三處一起改。
標題欄位用 \\n 表示換行（同孩子的一天的拍立得標題），其餘欄位不收換行。
"""
from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, Field, ValidationInfo, field_validator, model_validator

from app.content.schemas import (
    MEDIA_ALT_MAX_LENGTH,
    MediaSlotPayload,
    _ContentPayload,
    _reject_unsafe_strings,
)


def page_title(value: str, *, per_line: int, max_lines: int = 3, what: str = "標題") -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    if not value.strip():
        raise ValueError(f"{what}不可空白")
    lines = value.split("\n")
    if len(lines) > max_lines:
        raise ValueError(f"{what}最多 {max_lines} 行")
    for line in lines:
        if not line.strip():
            raise ValueError(f"{what}不能有空白行")
        if len(line) > per_line:
            raise ValueError(f"{what}每行最多 {per_line} 字（有一行 {len(line)} 字）")
    return value


def page_text(value: str, *, limit: int, what: str, allow_blank: bool = False) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError(f"{what}不能換行")
    if not value.strip():
        # 可留空的欄位只打空白＝留空（官網判斷有字才顯示，存成空白會畫出一個空的提醒）。
        if allow_blank:
            return ""
        raise ValueError(f"{what}不可空白")
    if len(value) > limit:
        raise ValueError(f"{what}最多 {limit} 字")
    return value


def exactly(value: list, count: int, what: str) -> list:
    if len(value) != count:
        raise ValueError(f"{what}固定 {count} 項，不能增減")
    return value


class PagePhotoFields(_ContentPayload):
    """清單項目的照片版位：留空＝官網內建照片與內建說明。"""

    photo: MediaSlotPayload | None = None
    photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)


# 課程方向的順序就是官網的錯落排法（curriculum.css 的 cur-dir--<key>）；quote 是印在
# 顏料上的引言，沒有照片。
CURRICULUM_DIRECTION_KEYS = ("cognitive", "integrated", "multicultural", "quote", "autonomy", "activities", "art")


class CurriculumChapterPayload(_ContentPayload):
    label: str
    hint: str

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        return page_text(value, limit=10, what="章節名稱")

    @field_validator("hint")
    @classmethod
    def _hint(cls, value: str) -> str:
        return page_text(value, limit=14, what="章節小字")


class CurriculumYearPayload(_ContentPayload):
    motto: str
    text: str

    @field_validator("motto")
    @classmethod
    def _motto(cls, value: str) -> str:
        return page_text(value, limit=10, what="年段標語")

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return page_text(value, limit=100, what="年段說明")


# 品德培養（quote）整張印在一團顏料上，上限另訂（scripts/page-copy-stress.cjs 在 390／820／1024／1440 實測）：
# sub 是大字引言（curriculum.css 的 .cur-dir--quote .cur-dir-sub，clamp(2.5rem, 4.2vw, 3.75rem)），手機與桌機
# 一行只放得下 5 個字，10 字＝兩行還在顏料上、三行就頂出去；text 是引言下面的一行說明，桌機超過約 21 字
# 換成兩行時會把引言往上推出顏料。
QUOTE_SUB_LIMIT = 10
QUOTE_TEXT_LIMIT = 20


class CurriculumDirectionPayload(PagePhotoFields):
    key: str
    title: str
    sub: str
    text: str

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return page_text(value, limit=10, what="課程方向的標題")

    @field_validator("sub")
    @classmethod
    def _sub(cls, value: str, info: ValidationInfo) -> str:
        if info.data.get("key") == "quote":
            return page_text(value, limit=QUOTE_SUB_LIMIT, what="品德培養的引言")
        return page_text(value, limit=30, what="課程方向的副標")

    @field_validator("text")
    @classmethod
    def _text(cls, value: str, info: ValidationInfo) -> str:
        if info.data.get("key") == "quote":
            return page_text(value, limit=QUOTE_TEXT_LIMIT, what="品德培養的說明")
        return page_text(value, limit=50, what="課程方向的說明")


class CurriculumArtworkPayload(PagePhotoFields):
    label: str

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        return page_text(value, limit=10, what="作品名稱")


class CurriculumDailyPayload(PagePhotoFields):
    title: str
    text: str

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return page_text(value, limit=8, what="五件事的名稱")

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return page_text(value, limit=160, what="五件事的介紹")


def _belief(value: str) -> str:
    return page_text(value, limit=24, what="教學理念")


# 逐項驗證：超過字數時 422 的 loc 是 ("beliefs", 4)，後台才定位得到第 5 項。
CurriculumBelief = Annotated[str, AfterValidator(_belief)]

# 欄位: (每行字數, 欄位名稱)
_CURRICULUM_TITLES = {
    "hero_title": (14, "首屏大標"),
    "years_title": (16, "四個年段的標題"),
    "directions_title": (16, "課程方向的標題"),
    "gallery_title": (16, "兒童美術館的標題"),
    "daily_title": (16, "五件事的標題"),
    "belief_title": (18, "教學理念的標題"),
}
# 欄位: (上限, 欄位名稱, 可留空)
_CURRICULUM_TEXTS = {
    "hero_eyebrow": (24, "首屏小標", False),
    "hero_highlight": (8, "大標裡畫顏料的字", True),
    "hero_lede": (90, "首屏介紹", False),
    "hero_notice": (60, "首屏提醒", True),
    "years_text": (80, "四個年段的說明", False),
    "spiral_label": (10, "螺旋式課程的標題", False),
    "spiral_text": (60, "螺旋式課程的說明", False),
    "years_caption": (30, "照片下方文字", True),
    "directions_text": (80, "課程方向的說明", False),
    "gallery_text": (80, "兒童美術館的說明", False),
    "gallery_source": (50, "作品照片出處", True),
    "daily_text": (80, "五件事的說明", False),
    "daily_source": (30, "五件事的出處", True),
    "belief_close": (50, "教學理念的結語", False),
    "belief_source": (30, "教學理念的出處", True),
}


class CurriculumPagePayload(_ContentPayload):
    """特色教學頁（/curriculum）。英文小字、章節編號、年段名稱與年齡、顏料與版面
    寫在官網 CurriculumContent.vue，不在這裡。"""

    hero_eyebrow: str
    hero_title: str
    # 大標裡要畫橘色顏料的字（必須和大標同一行裡的字一模一樣）；空字串＝不畫。
    hero_highlight: str = ""
    hero_lede: str
    hero_notice: str
    hero_photo: MediaSlotPayload | None = None
    hero_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    chapters: list[CurriculumChapterPayload]
    years_title: str
    years_text: str
    spiral_label: str
    spiral_text: str
    years_photo: MediaSlotPayload | None = None
    years_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    years_caption: str
    years: list[CurriculumYearPayload]
    directions_title: str
    directions_text: str
    directions: list[CurriculumDirectionPayload]
    gallery_title: str
    gallery_text: str
    gallery_source: str
    gallery: list[CurriculumArtworkPayload]
    daily_title: str
    daily_text: str
    daily_source: str
    daily: list[CurriculumDailyPayload]
    belief_title: str
    beliefs: list[CurriculumBelief]
    belief_close: str
    belief_source: str

    @field_validator(*_CURRICULUM_TITLES)
    @classmethod
    def _titles(cls, value: str, info: ValidationInfo) -> str:
        per_line, what = _CURRICULUM_TITLES[info.field_name]
        return page_title(value, per_line=per_line, what=what)

    @field_validator(*_CURRICULUM_TEXTS)
    @classmethod
    def _texts(cls, value: str, info: ValidationInfo) -> str:
        limit, what, allow_blank = _CURRICULUM_TEXTS[info.field_name]
        return page_text(value, limit=limit, what=what, allow_blank=allow_blank)

    @field_validator("hero_highlight")
    @classmethod
    def _highlight_in_title(cls, value: str, info: ValidationInfo) -> str:
        title = info.data.get("hero_title")
        # 大標本身沒過驗證時 info.data 沒有它，交給大標的錯誤訊息。
        if value and isinstance(title, str) and not any(value in line for line in title.split("\n")):
            raise ValueError("大標裡畫顏料的字要和大標同一行裡的字一模一樣")
        return value

    @field_validator("chapters")
    @classmethod
    def _chapters(cls, value: list) -> list:
        return exactly(value, 4, "章節索引")

    @field_validator("years")
    @classmethod
    def _years(cls, value: list) -> list:
        return exactly(value, 4, "四個年段")

    @field_validator("directions")
    @classmethod
    def _directions(cls, value: list[CurriculumDirectionPayload]) -> list[CurriculumDirectionPayload]:
        if tuple(item.key for item in value) != CURRICULUM_DIRECTION_KEYS:
            raise ValueError("課程方向固定 7 項，項目與順序不能改")
        if any(item.key == "quote" and item.photo is not None for item in value):
            raise ValueError("品德培養是印在顏料上的引言，沒有照片")
        return value

    @field_validator("gallery")
    @classmethod
    def _gallery(cls, value: list) -> list:
        return exactly(value, 8, "兒童美術館的作品")

    @field_validator("daily")
    @classmethod
    def _daily(cls, value: list) -> list:
        return exactly(value, 5, "五件事")

    @field_validator("beliefs")
    @classmethod
    def _beliefs(cls, value: list[str]) -> list[str]:
        return exactly(value, 5, "教學理念")

    @model_validator(mode="after")
    def _no_script_scheme(self) -> "CurriculumPagePayload":
        _reject_unsafe_strings(self.model_dump())
        return self


# 沿革五站的順序就是立體書紙條上的五站與右頁卡紙的位置（AboutContent.vue 的 STAGE）。
ABOUT_MILESTONE_KEYS = ("yihua", "minghua", "chongde", "international", "renwu")


class AboutMilestonePayload(_ContentPayload):
    key: str
    # 民國年由官網換算（西元 − 1911）。義華創校年份待園方確認（1997／1998），所以開放改。
    year: int = Field(ge=1950, le=2100)
    text: str

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return page_text(value, limit=30, what="沿革說明")


def _chapter_name(value: str) -> str:
    return page_text(value, limit=6, what="章名")


def _hope_quote(value: str) -> str:
    return page_text(value, limit=70, what="期許")


# 逐項驗證：422 的 loc 帶索引（例如 ("hope_quotes", 1)），後台才定位得到第幾項。
AboutChapterName = Annotated[str, AfterValidator(_chapter_name)]
AboutHopeQuote = Annotated[str, AfterValidator(_hope_quote)]

# 欄位: (每行字數, 欄位名稱)
_ABOUT_TITLES = {
    "hero_title": (7, "首屏大標"),
    "story_title": (7, "一路走來的標題"),
    "whole_title": (9, "全人教育的標題"),
    "hope_title": (9, "我們的期許的標題"),
}
# 欄位: (上限, 欄位名稱, 可留空)
_ABOUT_TEXTS = {
    "hero_lede": (120, "首屏介紹", False),
    "hero_caption": (20, "首屏照片上的一句話", False),
    "story_text": (120, "一路走來的說明", False),
    "whole_text": (100, "全人教育的說明", False),
    "whole_fine": (100, "全人教育的補充", False),
    "whole_fine_source": (30, "全人教育的出處", True),
    # 也是首屏目次的最後一格，和章名一樣短。
    "outro_title": (6, "五所校園的標題", False),
    "outro_text": (80, "五所校園的說明", False),
}


class AboutPagePayload(_ContentPayload):
    """關於常春藤頁（/about，立體書）。六大領域與核心素養、家長怎麼說的內容、
    卡紙位置與顏色寫在官網 AboutContent.vue；校名與校區照片來自各校的五校介紹。"""

    hero_title: str
    hero_lede: str
    hero_caption: str
    hero_photo: MediaSlotPayload | None = None
    hero_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    hero_back_photo: MediaSlotPayload | None = None
    hero_back_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    # 一路走來、全人教育、我們的期許、家長怎麼說（第四章沒有家長分享時整章不出現）。
    chapter_names: list[AboutChapterName]
    story_title: str
    story_text: str
    milestones: list[AboutMilestonePayload]
    whole_title: str
    whole_text: str
    whole_fine: str
    whole_fine_source: str
    hope_title: str
    hope_quotes: list[AboutHopeQuote]
    hope_photo: MediaSlotPayload | None = None
    hope_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    outro_title: str
    outro_text: str

    @field_validator(*_ABOUT_TITLES)
    @classmethod
    def _titles(cls, value: str, info: ValidationInfo) -> str:
        per_line, what = _ABOUT_TITLES[info.field_name]
        return page_title(value, per_line=per_line, what=what)

    @field_validator(*_ABOUT_TEXTS)
    @classmethod
    def _texts(cls, value: str, info: ValidationInfo) -> str:
        limit, what, allow_blank = _ABOUT_TEXTS[info.field_name]
        return page_text(value, limit=limit, what=what, allow_blank=allow_blank)

    @field_validator("chapter_names")
    @classmethod
    def _chapter_names(cls, value: list[str]) -> list[str]:
        return exactly(value, 4, "章名")

    @field_validator("milestones")
    @classmethod
    def _milestones(cls, value: list[AboutMilestonePayload]) -> list[AboutMilestonePayload]:
        if tuple(item.key for item in value) != ABOUT_MILESTONE_KEYS:
            raise ValueError("沿革固定五站（義華、明華、崇德、國際、仁武），順序不能改")
        if any(later.year < earlier.year for earlier, later in zip(value, value[1:])):
            raise ValueError("沿革年份要由早到晚（可以同年）")
        return value

    @field_validator("hope_quotes")
    @classmethod
    def _hope_quotes(cls, value: list[str]) -> list[str]:
        return exactly(value, 2, "期許")

    @model_validator(mode="after")
    def _no_script_scheme(self) -> "AboutPagePayload":
        _reject_unsafe_strings(self.model_dump())
        return self
