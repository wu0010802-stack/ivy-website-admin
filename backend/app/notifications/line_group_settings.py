"""LINE 群組的通知設定與推播目標計算（2026-11-17，設計 §4.4）。

目標＝該校的校區群組 ∪ 所有總部群組（`is_hq`）；沒有設定列的群組用預設值。
`left_at` 不為空（bot 已被移出）的群組一律不算。"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.campuses.models import Campus
from app.notifications.models import LineCampusTarget, LineGroup, LineGroupSetting

STAFF_KINDS: tuple[str, ...] = (
    "visit_request_created",
    "visit_request_confirmed",
    "visit_request_rescheduled",
    "visit_request_cancelled",
)
# 不是案件通知、預設不開的種類（2026-11-20）：stats_health＝官網統計異常（app/operations/stats_health.py），
# 只推給開了它的總部群組。
EXTRA_KINDS: tuple[str, ...] = ("stats_health",)
GROUP_KINDS: tuple[str, ...] = (*STAFF_KINDS, *EXTRA_KINDS)


@dataclass(frozen=True)
class GroupTarget:
    target_id: str
    kinds: frozenset[str]
    digest_enabled: bool
    mention_all_same_day: bool
    is_hq: bool


def _target(target_id: str, setting: LineGroupSetting | None) -> GroupTarget:
    if setting is None:
        return GroupTarget(target_id, frozenset(STAFF_KINDS), True, True, False)
    return GroupTarget(
        target_id,
        frozenset(setting.kinds or ()),
        setting.digest_enabled,
        setting.mention_all_same_day,
        setting.is_hq,
    )


async def targets_for(db: AsyncSession, campus_key: str) -> list[GroupTarget]:
    campus_ids = (
        await db.execute(
            select(LineCampusTarget.target_id)
            .join(LineGroup, LineGroup.target_id == LineCampusTarget.target_id)
            .where(LineCampusTarget.campus_key == campus_key, LineGroup.left_at.is_(None))
        )
    ).scalars().all()
    hq_ids = (
        await db.execute(
            select(LineGroupSetting.target_id)
            .join(LineGroup, LineGroup.target_id == LineGroupSetting.target_id)
            .where(LineGroupSetting.is_hq.is_(True), LineGroup.left_at.is_(None))
        )
    ).scalars().all()
    ordered = list(dict.fromkeys([*campus_ids, *hq_ids]))
    if not ordered:
        return []
    settings = {
        s.target_id: s
        for s in (
            await db.execute(select(LineGroupSetting).where(LineGroupSetting.target_id.in_(ordered)))
        ).scalars()
    }
    return [_target(tid, settings.get(tid)) for tid in ordered]


async def campuses_served(db: AsyncSession, target_id: str, *, require_verified: bool = False) -> list[str] | None:
    """這個群組可查詢／操作的校區；群組不存在、已離開或不是任何目標回 None。

    require_verified：會寫入的按鈕（line_group_actions）才傳 True，群組還沒貼過後台驗證碼（2026-09-29 以前
    綁定的舊群組）也回 None。查名單、卡片推播、每日摘要不傳，舊群組照常。"""
    group = (
        await db.execute(select(LineGroup.left_at, LineGroup.verified_at).where(LineGroup.target_id == target_id))
    ).one_or_none()
    if group is None or group.left_at is not None:
        return None
    if require_verified and group.verified_at is None:
        return None
    is_hq = (
        await db.execute(select(LineGroupSetting.is_hq).where(LineGroupSetting.target_id == target_id))
    ).scalar_one_or_none()
    if is_hq:
        return list(
            (await db.execute(select(Campus.key).where(Campus.active.is_(True)).order_by(Campus.key)))
            .scalars()
            .all()
        )
    keys = (
        await db.execute(
            select(LineCampusTarget.campus_key)
            .where(LineCampusTarget.target_id == target_id)
            .order_by(LineCampusTarget.campus_key)
        )
    ).scalars().all()
    return list(keys) or None


async def is_hq_group(db: AsyncSession, target_id: str) -> bool:
    """這個群組是不是總部群組（總管理者在後台指定）。統計、額度這類只給總部的指令用（2026-11-25）。"""
    return bool(await db.scalar(select(LineGroupSetting.is_hq).where(LineGroupSetting.target_id == target_id)))


async def digest_targets(db: AsyncSession) -> list[tuple[GroupTarget, list[str]]]:
    """每日摘要的收件群組（設計 §4.2）：校區群組或總部群組、未離開、`digest_enabled`，連同它服務的校區
    （總部＝所有營運中校區；校區群組＝指到它的校區）。沒有任何校區可服務的不回。"""
    campus_rows = (
        await db.execute(
            select(LineCampusTarget.target_id, LineCampusTarget.campus_key)
            .join(LineGroup, LineGroup.target_id == LineCampusTarget.target_id)
            .where(LineGroup.left_at.is_(None))
            .order_by(LineCampusTarget.target_id, LineCampusTarget.campus_key)
        )
    ).all()
    hq_ids = (
        await db.execute(
            select(LineGroupSetting.target_id)
            .join(LineGroup, LineGroup.target_id == LineGroupSetting.target_id)
            .where(LineGroupSetting.is_hq.is_(True), LineGroup.left_at.is_(None))
            .order_by(LineGroupSetting.target_id)
        )
    ).scalars().all()
    served: dict[str, list[str]] = {}
    for target_id, campus_key in campus_rows:
        served.setdefault(target_id, []).append(campus_key)
    if hq_ids:
        all_keys = list(
            (await db.execute(select(Campus.key).where(Campus.active.is_(True)).order_by(Campus.key)))
            .scalars()
            .all()
        )
        for target_id in hq_ids:
            served[target_id] = all_keys
    if not served:
        return []
    settings = {
        s.target_id: s
        for s in (
            await db.execute(select(LineGroupSetting).where(LineGroupSetting.target_id.in_(list(served))))
        ).scalars()
    }
    result = []
    for target_id, keys in served.items():
        target = _target(target_id, settings.get(target_id))
        if target.digest_enabled and keys:
            result.append((target, keys))
    return result
