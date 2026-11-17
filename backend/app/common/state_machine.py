"""狀態機的宣告型別。登記表在 app/state_machines.py。

這個專案的狀態一直是「一個字串欄位＋各函式自己的 if」；哪些狀態、哪些轉移合法、
由誰寫入，要逐檔讀才知道。這裡只提供兩個不可變的宣告型別，把這些事寫成資料：

- StateMachine：資料表裡真的有狀態欄位的（預約案件、通知 outbox、素材…）。
- DerivedMachine：沒有狀態欄位、由幾個欄位推導出來的（家長連結、登入 session…）。

宣告本身不參與執行期的判斷——守衛仍在各自的 service 裡。兩者不會悄悄分歧，是靠
tests/test_state_machines.py：狀態值對照 model 的 Enum／CHECK、每條轉移的寫入函式
真的存在且寫了那個值、登記以外的檔案不准寫狀態欄位。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Transition:
    """一條轉移。source 為 None 代表建立（進入初始狀態）。

    via 是寫入這個狀態的函式，格式 "模組路徑:函式名"；守門測試會解析它。"""

    source: str | None
    target: str
    via: str
    guard: str = ""
    effects: str = ""


@dataclass(frozen=True)
class StateMachine:
    key: str
    title: str
    model: str  # "模組路徑:類別名"
    field: str
    states: dict[str, str]  # 值 → 畫面上的中文名稱
    transitions: tuple[Transition, ...]
    # 可以寫這個欄位的檔案（相對 backend/）。其他檔案寫了，守門測試會失敗。
    writers: tuple[str, ...]
    notes: str = ""
    # 狀態不存欄位、由這幾個欄位推導，但仍有明確的轉移表（招生階段）：field 留空。
    derived_from: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if bool(self.field) == bool(self.derived_from):
            raise ValueError(f"{self.key}：field 與 derived_from 要剛好給一個")
        for transition in self.transitions:
            for state in (transition.source, transition.target):
                if state is not None and state not in self.states:
                    raise ValueError(f"{self.key}：轉移用到沒宣告的狀態 {state!r}")
        if not self.initial_states:
            raise ValueError(f"{self.key}：沒有建立用的轉移（source=None）")

    @property
    def initial_states(self) -> tuple[str, ...]:
        return _unique(t.target for t in self.transitions if t.source is None)

    @property
    def terminal_states(self) -> tuple[str, ...]:
        """沒有任何轉移離開的狀態。"""
        leaving = {t.source for t in self.transitions}
        return tuple(state for state in self.states if state not in leaving)

    def targets(self, source: str) -> tuple[str, ...]:
        """從 source 可以到的狀態（不含自己；未知狀態丟 ValueError）。"""
        if source not in self.states:
            raise ValueError(f"{self.key}：未知的狀態 {source!r}")
        return _unique(t.target for t in self.transitions if t.source == source and t.target != source)

    def allows(self, source: str, target: str) -> bool:
        return target in self.targets(source)


@dataclass(frozen=True)
class DerivedState:
    name: str
    label: str
    rule: str  # 這個狀態成立的條件，用欄位寫


@dataclass(frozen=True)
class DerivedMachine:
    """沒有狀態欄位：狀態由 fields 推導，判斷集中在 decided_by。"""

    key: str
    title: str
    model: str
    fields: tuple[str, ...]
    states: tuple[DerivedState, ...]
    decided_by: tuple[str, ...]  # 判斷狀態的函式，"模組路徑:函式名"
    changed_by: tuple[str, ...]  # 改動這些欄位的函式
    notes: str = ""


def _unique(values) -> tuple[str, ...]:
    return tuple(dict.fromkeys(values))
