"""招生入學的固定列舉與欄位長度（規格 5.4）。文字照園務原文，A8 的契約測試
拿 contracts/ivy-recruitment/ivy-schema.json 鎖定；其他檔案一律從這裡匯入，
不另寫一份。"""

from __future__ import annotations

# 園務 ivy-frontend constants/recruitment.ts GRADES_ORDER；官網分班對照的「小一」不列入。
GRADES: tuple[str, ...] = ("幼幼班", "小班", "中班", "大班")

# 園務 api/recruitment/shared.py:43-52，順序照園務。
NO_DEPOSIT_REASONS: tuple[str, ...] = (
    "時程未到／仍在觀望",
    "已有其他就學選項／比較他校",
    "未註明／待追蹤",
    "距離／地點因素",
    "家庭照顧安排考量",
    "特殊需求／名額限制",
    "課程／環境仍在評估",
    "費用考量",
)
# 園務 shared.py:59-75 的轉換潛力分組；「未註明／待追蹤」不屬於任何一組。
NO_DEPOSIT_PRIORITY: dict[str, tuple[str, ...]] = {
    "high": ("時程未到／仍在觀望", "課程／環境仍在評估"),
    "medium": ("距離／地點因素", "費用考量", "家庭照顧安排考量"),
    "low": ("已有其他就學選項／比較他校", "特殊需求／名額限制"),
}

# 來源分類代碼 → 園務文案（models/recruitment_bonus.py:51-61 DEFAULT_POINT_CATALOG）。
# NULL＝待歸類。官網不算獎金，只保留代碼讓資料能轉回園務。
SOURCE_CATEGORIES: dict[str, str] = {
    "sibling_current": "在校生弟妹（兄姊老師）",
    "sibling_split": "在校兄姊二人均分",
    "sibling_graduate": "畢業生弟妹",
    "self_report": "自報生（廣告／鄰居／網路／假日活動）",
    "referral": "有緣名單（家長介紹／社區招生）",
    "invite_success": "邀約來園——邀約成功者",
    "invite_origin": "邀約來園——原本招生人",
    "home_deposit": "到家中收預繳",
    "returning": "舊生復學（獎金不計，考核 +1 另行人工）",
}

# 漏斗階段（園務 services/recruitment_funnel.py STAGES）。階段是推導出來的，不存欄位。
STAGES: tuple[str, ...] = ("visited", "deposited", "enrolled", "withdrawn")
STAGE_LABELS: dict[str, str] = {
    "visited": "已訪視",
    "deposited": "已預繳",
    "enrolled": "已註冊",
    "withdrawn": "退預繳／退註冊",
}

# recruitment_event_log.event_type。created 是官網延伸（園務不寫），匯出時不轉。
EVENT_TYPES: tuple[str, ...] = (
    "created",
    "deposit_added",
    "deposit_removed",
    "converted",
    "revert_converted",
    "withdrawn",
    "withdraw_cancelled",
    "seat_reserved",
    "seat_released",
)
WEBSITE_ONLY_EVENT_TYPES: tuple[str, ...] = ("created",)

# withdrawn_from：從哪一欄退出（退預繳／退註冊）。
WITHDRAWN_FROM: tuple[str, ...] = ("deposited", "enrolled")

# created 事件的 metadata_json.origin：手動新增，或由官網預約（已到場／補建）建立。
ORIGINS: tuple[str, ...] = ("manual", "visit_request")

ANONYMIZED_TEXT = "（已依保存政策匿名化）"
# 預約沒填孩子姓名時的招生訪視姓名（child_name NOT NULL），明細標示待補。
MISSING_CHILD_NAME = "（未填姓名）"

# 欄位長度（對齊園務 models/recruitment.py）
LEN_CHILD_NAME = 50
LEN_CONTACT = 50
LEN_PHONE = 100
LEN_ADDRESS = 200
LEN_DISTRICT = 30
LEN_SOURCE = 50
LEN_REFERRER = 50
LEN_COLLECTOR = 50
LEN_TOUR_GUIDE = 50
LEN_SOURCE_CATEGORY = 30
LEN_REASON_CODE = 60
LEN_GRADE = 20
LEN_MONTH = 10
LEN_SEQ_NO = 10
LEN_STAGE = 20
LEN_EVENT_TYPE = 40
# 2026-10-05 照園方紙本「幼兒基本資料」補的官網延伸欄位（園務沒有）。
LEN_ENGLISH_NAME = 50
LEN_OCCUPATION = 50
# notes／parent_response／no_deposit_reason_detail／withdraw_reason／reason 的 API 上限（DB 是 Text）。
TEXT_MAX = 2000

# 民國學年的合理範圍（API 驗證用）：100＝西元 2011，200＝西元 2111。
SCHOOL_YEAR_MIN = 100
SCHOOL_YEAR_MAX = 200

# ---- 參觀後追蹤（2026-10-04 規格 docs/specs/2026-10-04-admissions-follow-up-design.md）----
# 官網延伸，園務沒有對應；匯出放在 extensions 與 recruitment_contact_logs 延伸檔。

# 聯絡方式代碼 → 後台文案（recruitment_contact_logs.channel）。
CONTACT_CHANNELS: dict[str, str] = {
    "phone": "電話",
    "line": "LINE",
    "in_person": "當面",
    # 2026-10-05 照紙本「再參觀／電訪」補。
    "revisit": "再參觀",
    "other": "其他",
}
LEN_CHANNEL = 16
# 一筆聯絡紀錄內容的上限（同預約聯絡紀錄 visit_contact_notes.note）。
CONTACT_NOTE_MAX = 1000

# 追蹤狀態（規格 6.2）：只看未匿名化、已訪視或已預繳的訪視。只有 due 算待辦。
FOLLOW_UP_KINDS: tuple[str, ...] = ("due", "upcoming", "unscheduled")
# 待追蹤分頁「7 天內」的範圍；upcoming 一律只算這個範圍內的。
UPCOMING_WINDOW_DAYS = 7
# 待追蹤與訪視明細的負責人篩選：me＝自己、none＝未指派，或帳號 id。
OWNER_FILTER_PATTERN = r"^(me|none|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
