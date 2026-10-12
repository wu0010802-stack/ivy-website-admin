from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.contact_phrases import service
from app.contact_phrases.schemas import ContactPhrasesOut, ContactPhrasesUpdate
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["contact-phrases"])


def _out(view: service.PhraseSetView) -> ContactPhrasesOut:
    return ContactPhrasesOut(
        phrases=view.phrases,
        version=view.version,
        updated_at=view.updated_at,
        updated_by_name=view.updated_by_name,
    )


@router.get("/admin/contact-phrases", response_model=ContactPhrasesOut)
async def get_contact_phrases(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContactPhrasesOut:
    """總部統一維護的聯絡片語，案件與招生的聯絡紀錄輸入框上方的快捷按鈕用。
    看得到預約案件或招生訪視的角色都能讀。"""
    require_scope(current_user, "contact_phrases.read")
    return _out(await service.read(db))


@router.put("/admin/contact-phrases", response_model=ContactPhrasesOut)
async def update_contact_phrases(
    payload: ContactPhrasesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ContactPhrasesOut:
    """整組換掉片語，存檔立即生效（不經草稿與發布）。只有總管理者；版本不符 409。
    稽核只記句數，不記片語內容。"""
    require_scope(current_user, "contact_phrases.manage")
    try:
        view = await service.replace(
            db, payload.phrases, expected_version=payload.expected_version, updated_by=current_user.id
        )
    except service.PhrasesVersionConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "CONTACT_PHRASES_VERSION_CONFLICT",
                "message": "片語剛被其他人修改，請重新載入後再編輯",
                "current_version": exc.current_version,
            },
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="contact_phrases.update",
        target_type="contact_phrases",
        target_id=service.KEY,
        metadata={"count": len(view.phrases)},
    )
    await db.commit()
    return _out(view)
