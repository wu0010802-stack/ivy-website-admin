"""全站狀態機登記表：哪些狀態、哪些轉移合法、由哪個函式寫入。

要改狀態或加轉移，先改這裡，再改對應的 service；兩邊不一致時
tests/test_state_machines.py 會失敗。給人看的版本在 docs/state-machines/domain.md，
給前端用的在 contracts/state-machines.json 與 contracts/generated/state-machines.d.ts，
三個檔都由 `npm run contract:generate` 從這張表產生，不要手改。

這個模組不被執行期程式匯入（只有測試與匯出腳本用），所以放心從各領域匯入列舉。"""

from __future__ import annotations

from app.ad_conversions import models as ad_models
from app.admissions import constants as admissions_constants
from app.admissions import funnel
from app.admissions.roster import models as roster_models
from app.booking.export_labels import STATUS_LABELS as VISIT_STATUS_LABELS
from app.booking.models import OutboxStatus, VisitRequestStatus
from app.common.state_machine import DerivedMachine, DerivedState, StateMachine, Transition
from app.content.models import REVIEW_STATUSES
from app.facebook.models import POST_STATUSES
from app.media.models import MediaJobStatus, MediaStatus


def _labelled(values, labels: dict[str, str]) -> dict[str, str]:
    """照 values 的順序配上中文名稱；兩邊對不上就在匯入時丟錯。"""
    values = tuple(getattr(value, "value", value) for value in values)
    if set(values) != set(labels):
        raise ValueError(f"狀態與標籤對不上：{sorted(set(values) ^ set(labels))}")
    return {value: labels[value] for value in values}


VISIT_REQUEST = StateMachine(
    key="visit_request",
    title="預約參觀案件",
    model="app.booking.models:VisitRequest",
    field="status",
    states=_labelled(VisitRequestStatus, VISIT_STATUS_LABELS),
    transitions=(
        Transition(None, "confirmed", "app.booking.service:submit_visit_request",
                   guard="官網送單；同一個交易排進場次，名額不足整筆不成立",
                   effects="發家長管理連結、通知園方、有留 Email 才寄確認信"),
        Transition(None, "confirmed", "app.booking.service:create_manual_visit_request",
                   guard="後台補登（電話、LINE、親自到園）"),
        Transition("confirmed", "cancelled", "app.booking.workflow_service:cancel",
                   guard="已取消再取消是冪等的（直接回傳、不寫歷程）；未到場、已到場不能取消",
                   effects="寫 cancelled_at、cancel_reason；撤銷家長連結；通知園方；有場次才寄取消信；名額釋出"),
        Transition("confirmed", "no_show", "app.booking.workflow_service:mark_no_show",
                   guard="場次開始後才能標；家長事先說不來走取消",
                   effects="撤銷家長連結；名額仍占用"),
        Transition("confirmed", "completed", "app.booking.workflow_service:mark_completed",
                   guard="場次開始後才能標；提早到（early）不等場次開始",
                   effects="撤銷家長連結；排廣告到場回傳；招生入學開啟時同一個交易建招生訪視；"
                           "提早到且場次在之後的日子會清掉 slot_id 釋出名額"),
    ),
    writers=("app/booking/service.py", "app/booking/workflow_service.py"),
    notes="改期（reschedule）與改資料不換狀態，只有 confirmed 能做。每個轉移都先 lock_status（SELECT … FOR UPDATE）"
          "重讀狀態。列表的「接下來／時間已過／已到場／已取消」是 app/booking/status_groups.py 由狀態加場次時間推導的"
          "顯示分組，不是另一個狀態欄位。守衛不通過一律 409 INVALID_TRANSITION。",
)

OUTBOX_MESSAGE = StateMachine(
    key="outbox_message",
    title="通知 outbox",
    model="app.booking.models:OutboxMessage",
    field="status",
    states=_labelled(OutboxStatus, {
        "pending": "待寄送", "leased": "寄送中", "sent": "已寄出", "failed": "寄送失敗", "skipped": "已略過",
    }),
    transitions=(
        Transition(None, "pending", "app.booking.outbox:enqueue_outbox", guard="給園方的通知"),
        Transition(None, "pending", "app.booking.outbox:enqueue_parent_email", guard="給家長的信；沒 Email、沒綁 LINE、這校也沒開通知型訊息才不排"),
        Transition(None, "pending", "app.booking.outbox:enqueue_day_closed_email", guard="休假日通知，同一天同一案只排一次"),
        Transition(None, "pending", "app.notifications.reminders:_enqueue", guard="定期工作排的提醒"),
        Transition("pending", "leased", "app.workers.lease_service:claim_next",
                   guard="next_attempt_at 已到；租約過期的 leased 也會被重新認領"),
        Transition("leased", "sent", "app.workers.lease_service:ack"),
        Transition("leased", "pending", "app.workers.lease_service:fail", guard="未達重試上限：退避 10/30/60/300/900 秒"),
        Transition("leased", "failed", "app.workers.lease_service:fail", guard="重試滿 MAX_ATTEMPTS 次"),
        Transition("leased", "skipped", "app.workers.lease_service:skip", guard="寄送當下已不適用（改期、取消、已處理）"),
        Transition("failed", "pending", "app.workers.lease_service:requeue", guard="後台手動重新排入；呼叫端先確認是 failed",
                   effects="重試次數歸零；已送達的管道記在 notification_deliveries，重送時略過"),
    ),
    writers=("app/booking/outbox.py", "app/notifications/reminders.py", "app/workers/lease_service.py"),
    notes="status 欄位沒有資料庫 CHECK，值域只靠 OutboxStatus。案件結案後排隊中的通知不會被取消，"
          "而是寄送時由 app/notifications/service.py 依案件狀態決定寄或略過。",
)

MEDIA_ASSET = StateMachine(
    key="media_asset",
    title="素材",
    model="app.media.models:MediaAsset",
    field="status",
    states=_labelled(MediaStatus, {"processing": "處理中", "ready": "可用", "failed": "失敗"}),
    transitions=(
        Transition(None, "processing", "app.media.service:create_media_asset"),
        Transition("processing", "ready", "app.media.service:_write_image_variants", guard="圖片：縮圖寫完"),
        Transition("processing", "failed", "app.media.service:_write_image_variants", guard="圖片：縮圖失敗"),
        Transition("processing", "ready", "app.media.jobs:_apply", guard="影片：process 工作做完（backfill 不動素材狀態）"),
        Transition("processing", "failed", "app.media.jobs:_mark_failed", guard="影片：process 工作失敗且不再重試"),
        Transition("failed", "processing", "app.media.jobs:retry", guard="只有影片、失敗、未刪除的可以重新處理"),
    ),
    writers=("app/media/service.py", "app/media/jobs.py"),
    notes="刪除是另一個維度（deleted_at，見 media_deletion）。內容發布前要求用到的素材都是 ready 且未刪除"
          "（app/content/publish_jobs.py check_publishable）。資料庫的原生 enum media_status 存的是大寫成員名"
          "（PROCESSING…），API 回的是小寫的值；直接下 SQL 查要用大寫。",
)

MEDIA_JOB = StateMachine(
    key="media_job",
    title="影片轉檔工作",
    model="app.media.models:MediaJob",
    field="status",
    states=_labelled(MediaJobStatus, {"pending": "排隊中", "running": "轉檔中", "done": "完成", "failed": "失敗"}),
    transitions=(
        Transition(None, "pending", "app.media.jobs:enqueue", guard="同一個素材最多一筆 pending／running（uq_media_jobs_active）"),
        Transition("pending", "running", "app.media.jobs:claim_next", guard="租約過期的 running 也會被重新認領"),
        Transition("pending", "running", "app.media.jobs:process_now", guard="不經排程直接處理"),
        Transition("running", "done", "app.media.jobs:_apply"),
        Transition("running", "done", "app.media.jobs:_finish", guard="素材已不需要這份工作時直接收掉"),
        Transition("running", "pending", "app.media.jobs:_record_failure", guard="可重試的失敗"),
        Transition("running", "pending", "app.media.jobs:release", guard="worker 關機時放回佇列"),
        Transition("running", "failed", "app.media.jobs:_mark_failed"),
    ),
    writers=("app/media/jobs.py",),
    notes="收尾一律比對 leased_by，租約被別人接走的 worker 不能回寫。",
)

CONTENT_REVISION = StateMachine(
    key="content_revision",
    title="內容版本的審核狀態",
    model="app.content.models:ContentRevision",
    field="review_status",
    states=_labelled(REVIEW_STATUSES, {
        "draft": "草稿", "pending_review": "待審核", "approved": "已核准", "rejected": "已退回", "superseded": "已被新版取代",
    }),
    transitions=(
        Transition(None, "draft", "app.content.service:create_revision"),
        Transition("draft", "pending_review", "app.content.routes:submit_for_review", guard="只能送最新版"),
        Transition("rejected", "pending_review", "app.content.routes:submit_for_review", guard="只能送最新版"),
        Transition("pending_review", "approved", "app.content.routes:review_submission", effects="核准即發布"),
        Transition("pending_review", "rejected", "app.content.routes:review_submission",
                   guard="必附原因", effects="這一版還在等的排程一起取消"),
        Transition("pending_review", "approved", "app.content.service:_mark_live",
                   guard="待審版被直接發布、排程到期或還原時順手核准", effects="通知送審人"),
        Transition("pending_review", "superseded", "app.content.service:supersede_pending_reviews",
                   guard="存了更新的一版，或有任何一版上線"),
    ),
    writers=("app/content/routes.py", "app/content/service.py"),
    notes="「已發布」不在這個欄位：看 ContentItem.current_published_revision_id 與 SiteState.current_release_id。"
          "草稿被直接發布後 review_status 仍是 draft。發布與排程只擋 rejected。",
)

PUBLISH_JOB = StateMachine(
    key="publish_job",
    title="排程發布",
    model="app.content.models:PublishJob",
    field="status",
    states={"scheduled": "等待發布", "done": "已發布", "failed": "沒有發布", "skipped": "已略過", "cancelled": "已取消"},
    transitions=(
        Transition(None, "scheduled", "app.content.routes:create_schedule",
                   guard="時間在未來、版本比線上新、不是已退回的版本、通過 check_publishable"),
        Transition("scheduled", "cancelled", "app.content.routes:cancel_schedule"),
        Transition("scheduled", "cancelled", "app.content.routes:review_submission", guard="這一版被退回"),
        Transition("scheduled", "done", "app.content.publish_jobs:_run_one"),
        Transition("scheduled", "skipped", "app.content.publish_jobs:_run_one", guard="官網已是較新的版本"),
        Transition("scheduled", "failed", "app.content.publish_jobs:_run_one", guard="到期時內容不能發布（例如素材沒轉好）"),
        Transition("scheduled", "failed", "app.content.publish_jobs:_fail_unexpected", guard="執行時出了預期外的錯"),
    ),
    writers=("app/content/routes.py", "app/content/publish_jobs.py"),
    notes="status 欄位沒有資料庫 CHECK。failed／skipped 之後還有「已處理」這一層，見 publish_job_resolution。",
)

RECRUITMENT_STAGE = StateMachine(
    key="recruitment_stage",
    title="招生訪視的階段",
    model="app.admissions.models:RecruitmentVisit",
    field="",
    derived_from=("withdrawn_at", "enrolled", "has_deposit"),
    states=_labelled(admissions_constants.STAGES, admissions_constants.STAGE_LABELS),
    transitions=(
        Transition(None, "visited", "app.admissions.records:create_visit"),
        Transition(None, "visited", "app.admissions.booking_link:ensure_from_visit_request", guard="預約標記已到場時自動建立"),
        # 轉移表的唯一來源是 funnel._CAPABILITY，這裡直接讀它。
        *(
            Transition(source, target, "app.admissions.funnel:transition", guard=f"需要 {capability}")
            for (source, target), capability in funnel._CAPABILITY.items()
        ),
    ),
    writers=("app/admissions/funnel.py",),
    notes="階段不存欄位：Python 用 funnel.derive_stage、SQL 用 funnel.stage_condition 推導，兩者規則相同。"
          "funnel.transition 是全模組唯一寫 enrolled、has_deposit、withdrawn_at 的地方，執行期就是讀 funnel._CAPABILITY。"
          "從已註冊退出後再取消退出一律要 admissions.convert（funnel.visit_transition_capability）。",
)

ROSTER_STUDENT = StateMachine(
    key="roster_student",
    title="編班的幼生",
    model="app.admissions.roster.models:RosterStudent",
    field="status",
    states=_labelled(roster_models.STUDENT_STATUSES, {
        "pending": "預繳未入園", "enrolled": "在籍", "left": "已離園", "refunded": "已退預繳",
    }),
    transitions=(
        Transition(None, "pending", "app.admissions.roster.sync:on_stage_changed", guard="招生看板轉成已預繳時自動建立"),
        Transition(None, "pending", "app.admissions.roster.service:create_students", guard="手動補登預繳生"),
        Transition(None, "enrolled", "app.admissions.roster.service:create_students", guard="手動補登在籍生"),
        Transition("pending", "enrolled", "app.admissions.roster.service:enter_student", guard="要先排進班級"),
        Transition("enrolled", "left", "app.admissions.roster.service:leave_student", guard="離園日不能早於入園日"),
        Transition("pending", "refunded", "app.admissions.roster.service:refund_student", guard="退預繳日不能早於預繳日期"),
        Transition("refunded", "pending", "app.admissions.roster.service:restore_student",
                   guard="看板已為同一筆訪視重建預繳生時不能恢復"),
        Transition("left", "enrolled", "app.admissions.roster.service:restore_student", guard="要選一個班級"),
    ),
    writers=("app/admissions/roster/service.py", "app/admissions/roster/sync.py"),
    notes="和招生訪視的階段是兩台各自獨立的狀態機，只有看板→編班單向同步；兩邊分歧時由 roster/sync.py 的"
          "board_notices 在畫面提示，不自動修正。",
)

AD_CONVERSION_JOB = StateMachine(
    key="ad_conversion_job",
    title="廣告轉換回傳",
    model="app.ad_conversions.models:AdConversionJob",
    field="status",
    states=_labelled(ad_models.STATUSES, {"pending": "待回傳", "sent": "已回傳", "failed": "回傳失敗", "skipped": "已略過"}),
    transitions=(
        Transition(None, "pending", "app.ad_conversions.service:enqueue", guard="案件有點擊識別碼才排；同案同事件同平台只一筆"),
        Transition("pending", "sent", "app.ad_conversions.service:_process_one"),
        Transition("pending", "skipped", "app.ad_conversions.service:_process_one",
                   guard="已匿名、已排除、平台沒設定、過期或沒有識別碼"),
        Transition("pending", "failed", "app.ad_conversions.service:_process_one", guard="平台拒收，或重試滿 MAX_ATTEMPTS 次"),
    ),
    writers=("app/ad_conversions/service.py",),
)

FACEBOOK_PAGE_POST = StateMachine(
    key="facebook_page_post",
    title="粉專貼文收件匣",
    model="app.facebook.models:FacebookPagePost",
    field="status",
    states=_labelled(POST_STATUSES, {"new": "未處理", "imported": "已轉成消息", "dismissed": "已略過"}),
    transitions=(
        Transition(None, "new", "app.facebook.sync:_write_posts", guard="同步只寫內文與媒體，不改已有貼文的狀態"),
        Transition("new", "dismissed", "app.facebook.routes:dismiss_facebook_post"),
        Transition("dismissed", "new", "app.facebook.routes:restore_facebook_post"),
        Transition("new", "imported", "app.facebook.routes:import_facebook_post", guard="貼文要有照片"),
        Transition("dismissed", "imported", "app.facebook.routes:import_facebook_post", guard="貼文要有照片"),
    ),
    writers=("app/facebook/routes.py",),
)

MACHINES: tuple[StateMachine, ...] = (
    VISIT_REQUEST,
    OUTBOX_MESSAGE,
    CONTENT_REVISION,
    PUBLISH_JOB,
    MEDIA_ASSET,
    MEDIA_JOB,
    RECRUITMENT_STAGE,
    ROSTER_STUDENT,
    AD_CONVERSION_JOB,
    FACEBOOK_PAGE_POST,
)


DERIVED: tuple[DerivedMachine, ...] = (
    DerivedMachine(
        key="parent_access",
        title="家長管理連結與 session",
        model="app.booking.access_models:ParentAccessToken",
        fields=("expires_at", "revoked_at"),
        states=(
            DerivedState("active", "有效", "revoked_at IS NULL 且 expires_at 還沒到"),
            DerivedState("expired", "已過期", "revoked_at IS NULL 且 expires_at 已到"),
            DerivedState("revoked", "已撤銷", "revoked_at 有值"),
        ),
        decided_by=(
            "app.booking.access_service:exchange_token",
            "app.booking.access_service:parent_session_active",
            "app.booking.access_service:get_visit_request_for_session",
            "app.booking.access_service:active_access_token",
        ),
        changed_by=(
            "app.booking.access_service:create_access_token",
            "app.booking.access_service:ensure_access_token",
            "app.booking.access_service:extend_token_expiry",
            "app.booking.access_service:revoke_access_for_visit_request",
        ),
        notes="ParentSession（同一個檔）用同一組欄位與規則，到期取 min(現在＋TTL, 連結到期)。案件結案（取消、未到場、"
              "已到場）與家長改 Email 都會撤銷；改期只延長到期。",
    ),
    DerivedMachine(
        key="visit_slot",
        title="參觀場次",
        model="app.booking.models:VisitSlot",
        fields=("closed", "closed_source"),
        states=(
            DerivedState("open", "開放", "closed 為 false"),
            DerivedState("closed_manual", "園方手動關閉", "closed 且 closed_source 是 manual（舊資料的 NULL 視同）"),
            DerivedState("closed_exception", "休假日關閉", "closed 且 closed_source 是 exception"),
            DerivedState("closed_rule", "不符合現行每週規則", "closed 且 closed_source 是 rule"),
        ),
        decided_by=(
            "app.booking.slot_service:is_publicly_bookable",
            "app.booking.slot_service:has_started",
        ),
        changed_by=(
            "app.booking.slot_service:update_slot",
            "app.booking.schedule_service:sync_rule_slots",
            "app.booking.schedule_service:_reopen_rule_slots",
            "app.booking.schedule_service:add_exception",
            "app.booking.schedule_service:remove_exception",
        ),
        notes="「額滿」「已開始」「可預約」不是存的狀態：額滿是即時數已占用的案件，已開始看場次時間，"
              "可預約再加最短提前時間與最遠天數。取消休假日只重開 exception 關掉的場次。",
    ),
    DerivedMachine(
        key="admin_session",
        title="後台登入 session",
        model="app.auth.models:Session",
        fields=("expires_at", "revoked_at"),
        states=(
            DerivedState("usable", "有效", "revoked_at IS NULL 且 expires_at 還沒到"),
            DerivedState("expired", "已過期", "revoked_at IS NULL 且 expires_at 已到"),
            DerivedState("revoked", "已撤銷", "revoked_at 有值"),
        ),
        decided_by=("app.auth.service:_session_usable",),
        changed_by=(
            "app.auth.service:create_session",
            "app.auth.service:refresh_session_expiry",
            "app.auth.service:revoke_session",
            "app.auth.service:revoke_user_sessions",
        ),
        notes="停用帳號、改密碼、用重設連結設新密碼都會撤銷該帳號的 session。",
    ),
    DerivedMachine(
        key="password_reset_token",
        title="重設密碼連結",
        model="app.auth.models:PasswordResetToken",
        fields=("used_at", "revoked_at", "expires_at"),
        states=(
            DerivedState("usable", "可用", "三個條件都不成立，且帳號是啟用的"),
            DerivedState("used", "已使用", "used_at 有值"),
            DerivedState("revoked", "已作廢", "revoked_at 有值"),
            DerivedState("expired", "已過期", "expires_at 已到"),
        ),
        decided_by=("app.auth.password_reset:rejection",),
        changed_by=(
            "app.auth.password_reset:issue",
            "app.auth.password_reset:revoke_outstanding",
            "app.auth.password_reset:revoke_token",
            "app.auth.password_reset_routes:complete_password_reset",
        ),
        notes="判斷順序：帳號停用 → 已使用 → 已作廢 → 已過期。發新連結會作廢舊的。",
    ),
    DerivedMachine(
        key="user_account",
        title="後台帳號",
        model="app.auth.models:User",
        fields=("is_active",),
        states=(
            DerivedState("active", "啟用", "is_active 為 true"),
            DerivedState("inactive", "停用", "is_active 為 false"),
        ),
        decided_by=("app.auth.service:still_valid_for_login",),
        changed_by=("app.auth.service:set_user_active",),
        notes="最後一位啟用中的總管理者不能停用；停用會解除 LINE／Google 綁定、撤銷所有 session、作廢重設連結。",
    ),
    DerivedMachine(
        key="media_deletion",
        title="素材的刪除",
        model="app.media.models:MediaAsset",
        fields=("deleted_at",),
        states=(
            DerivedState("kept", "保留", "deleted_at IS NULL"),
            DerivedState("pending_purge", "已刪除、等待清理", "deleted_at 有值"),
        ),
        decided_by=("app.media.service:purge_due",),
        changed_by=(
            "app.media.service:mark_deleted",
            "app.media.service:restore_deleted",
            "app.media.service:purge_due",
        ),
        notes="和 media_asset 的處理狀態互相獨立。被內容引用的素材不能刪；到期清理時發現又被引用會取消刪除。",
    ),
    DerivedMachine(
        key="publish_job_resolution",
        title="沒發布的排程是否已處理",
        model="app.content.models:PublishJob",
        fields=("status", "acknowledged_at", "finished_at"),
        states=(
            DerivedState("unresolved", "待處理", "status 是 failed／skipped，沒按過「知道了」，之後也沒有再發布"),
            DerivedState("resolved", "已處理", "acknowledged_at 有值，或內容在 finished_at 之後發布過"),
        ),
        decided_by=(
            "app.content.publish_jobs:is_resolved",
            "app.content.publish_jobs:unresolved_condition",
        ),
        changed_by=("app.content.routes:acknowledge_schedule",),
        notes="is_resolved（Python）與 unresolved_condition（SQL）是同一條規則的兩份寫法，改一邊要改另一邊。",
    ),
    DerivedMachine(
        key="error_group",
        title="錯誤回報分組",
        model="app.operations.models:ErrorGroup",
        fields=("resolved_at",),
        states=(
            DerivedState("open", "未處理", "resolved_at IS NULL"),
            DerivedState("resolved", "已處理", "resolved_at 有值"),
        ),
        decided_by=("app.operations.error_reports:list_groups",),
        changed_by=(
            "app.operations.error_reports:upsert",
            "app.operations.error_reports:resolve",
            "app.operations.error_reports:resolve_all",
        ),
        notes="已處理的錯誤再發生時，upsert 會把它重新打開。",
    ),
)


def by_key(key: str) -> StateMachine:
    for machine in MACHINES:
        if machine.key == key:
            return machine
    raise ValueError(f"沒有登記的狀態機：{key}")
