# 附錄：階段 A 既有後端測試改寫對照（Task A8 用）

來源：2026-09-30 對 `backend/tests/*.py` 逐檔盤點（唯讀），共 178 個測試受影響。行號是盤點時 `def` 所在行（origin/main `0a00625`），改檔後會位移，以測試名稱為準。

## 規則（先讀）

1. **Email**：`conftest.py` 的 `ParentClient.post` 已在 A1 補 `email` 預設值，一般送單測試不必逐一加。直接呼叫 `VisitRequestCreate.model_validate(...)` 的純 schema 測試（不經 ParentClient）要自己補 `slot_id`、`email`，否則它們會因為缺欄位而「假綠」（預期 422 的測試剛好也 422）。
2. **建案 helper**（A1 已加進 conftest）：
   - `book_slot(admin_client, public_client, ...)`：slots 模式送一筆，得到 `confirmed` 案件，**會**產生 outbox、analytics、修改連結。要測通知、LINE、匯出、統計、家長端的都用它。
   - `legacy_request(db_session, status=..., slot_id=..., hold_expires_at=..., email=..., source=..., party_size=...)`：直接寫 DB 一筆舊案（`new`／`contacting`／`pending_confirmation`，或指定其他狀態），**不會**產生 outbox／analytics／歷程。要測狀態機、搜尋、報表、逾期提醒的用它。`version` 固定為 1。
   - `create_slot(admin_client, campus_key=..., days_ahead=..., capacity=...)`：只建時段，回傳 slot id。
   - `legacy_reschedule_request(db_session, visit_request_id, requested_slot_id)`：直接寫一筆 pending 的舊改期申請（後台核准／退回仍保留，規格 §3.3）。
3. **補登**（`POST /admin/visit-requests`）body 一律要帶 `slot_id`。各檔的 `_manual`／`_manual_case`／`_create` helper 改成先 `create_slot` 再帶進 body。預期 404／403 的權限測試，確認錯誤仍先於 422 發生（FastAPI 先驗 body，所以 body 要合法才測得到權限）。
4. **不要**為了讓舊測試過而放寬新規則（例如讓送單不帶 `slot_id` 也可以）。測的是退場行為就刪，不要改成測別的。
5. 刪測試時，同一檔內只剩刪除測試在用的 helper 一併刪。
6. `slots_auto_confirm=True/False` 的參數（COSMETIC，約 55 處）：PATCH 請求 schema 已移除該欄位、pydantic 會忽略，功能不受影響；A8 順手移除，**但**斷言 `config.json()["slots_auto_confirm"]` 的一定要改（該欄位已不在回應裡）。

## 決策摘要

- 家長「申請改期」端點退場（410），但 `reschedule_requests` 表與後台 `approve`／`reject` 保留處理舊資料 → 測後台核准／退回的測試改用 `legacy_reschedule_request` 造資料，保留。
- `readiness.impact` 的 `new_requests`／`contacting`／`pending_confirmation` 欄位保留（舊資料仍可能有）。
- `BookingMode.INQUIRY` enum 值保留（DB 有歷史值），但 PATCH 會拒絕。

## 逐檔對照

分類：**SETUP**＝只換建案方式；**OBSOLETE**＝測退場行為，刪除或依建議改寫；**KEEP**＝舊資料仍會發生的行為，保留並用 `legacy_request` 造資料。

### test_booking_modes.py
helper `_inquiry_payload`、`_enable_inquiry` 刪除，改用 slots payload（`create_slot` ＋ `set_booking_mode(mode="slots")`）。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_campus_admin_cannot_update_other_campus_config | SETUP | PATCH 改 `mode="paused", message="…"` |
| test_campus_admin_can_update_own_campus_config | SETUP | 同上 |
| test_config_version_conflict_on_update | SETUP | 首次 PATCH 改 `paused`／`line` |
| test_public_booking_config_visible_without_auth | SETUP | 改 slots，斷言 `mode == "slots"` |
| test_paused_campus_rejects_submission | SETUP | payload 帶 slot_id，仍 409 BOOKING_UNAVAILABLE |
| test_line_mode_campus_rejects_form_submission | SETUP | 同上 |
| test_inquiry_submission_succeeds | OBSOLETE | 刪（A2 的 `test_self_booking_submit.py` 已涵蓋 slots 送單與 422） |
| test_request_retry_is_same_case | SETUP | slots payload，同 key 重播 200 |
| test_same_key_different_payload_rejected | SETUP | slots payload，capacity ≥ 2 |
| test_stale_config_version_rejected_then_switch_to_line | SETUP | 起始改 slots |
| test_mode_switch_does_not_affect_existing_requests | SETUP | 起始改 slots |
| test_invalid_phone_rejected | SETUP | slots payload（否則會因缺 slot_id 假綠） |
| test_missing_consent_rejected | SETUP | 同上 |

### test_secfix_booking.py
helper `_payload` 的 `slot_id=None` 預設改成必填參數；`_enable("inquiry")` 呼叫改 slots；`_slot` 預設 capacity 5 → 需要時調大。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_public_submit_never_calls_rate_limiter_while_holding_config_lock | OBSOLETE→改 | parametrize 刪 `"inquiry"`，保留 slots |
| test_turnstile_required_and_verified_server_side 等 7 個 turnstile 測試 | SETUP | slots＋slot_id |
| test_inquiry_submissions_do_not_count_as_slot_holds | OBSOLETE | 刪 |
| test_public_submissions_are_capped_per_campus_per_hour | SETUP | slots；每筆會占位，調高 `booking_slot_holds_per_source_per_day` 與 capacity |
| test_single_source_cannot_use_up_the_campus_cap | SETUP | 同上，重算「每來源每校每小時 5 筆」與每日占位上限並存時的預期 |
| test_phone_bucket_holds_under_concurrent_submissions | SETUP | slots；capacity 大 |
| test_concurrent_retry_of_the_last_allowed_submission_is_a_replay | SETUP | 同上 |
| test_retry_that_missed_the_first_replay_lookup_is_not_rate_limited | SETUP | 同上 |
| test_public_idempotency_key_cannot_use_reserved_prefix | SETUP | slots＋slot_id |
| test_new_payload_hash_is_keyed_and_legacy_hash_still_replays | SETUP | slots；legacy hash 的期望值要含 slot_id、email 重算 |
| test_manual_create_hash_is_keyed | SETUP | 補登 body 帶 slot_id |
| test_anonymize_scrubs_payload_hash_and_idempotency_key | SETUP | book_slot |
| test_sweep_scrubs_rows_anonymized_before_the_fix | SETUP | book_slot |
| test_public_submit_rejects_control_characters_with_422 | SETUP | slots（否則假綠） |
| test_public_submit_keeps_newlines_and_tabs | SETUP | slots |
| test_manual_note_rejects_control_characters | SETUP | 補登帶 slot_id（否則假綠） |

### test_visit_workflow.py
helper `_submit_inquiry` → `legacy_request(status="new")`；`_enable_slots(auto_confirm=...)` 去掉 `auto_confirm` 參數。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_manual_confirm_inquiry_into_slot | KEEP | `legacy_request(new)` → `/confirm` |
| test_no_show_requires_confirmed_status | SETUP | `legacy_request(new)`，仍 409 |
| test_confirmed_request_exposes_slot_time | KEEP | `legacy_request(new)` → `/confirm` |
| test_visit_request_search_by_name_and_phone | SETUP | `legacy_request(new, parent_name=…, phone=…)` |
| test_visit_request_search_treats_wildcards_as_text | SETUP | 同上 |
| test_visit_request_search_stays_inside_campus_scope | SETUP | 同上 |
| test_visit_request_follow_up_due_filter_and_order | SETUP | 同上（version=1） |
| test_contact_note_can_clear_follow_up | SETUP | 同上 |
| test_dashboard_counts_open_requests_with_hold_deadline | KEEP | new 與 pending 都用 `legacy_request`；刪「送單得 pending」斷言，保留 `next_hold_expires_at` |

### test_visit_case_handling.py
helper `_manual` 補 slot_id；`_parent_asks_for` 改成 `legacy_reschedule_request`（`test_audit_actions.py` 也 import 它，一起改）。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_staff_cannot_confirm_into_a_slot_that_already_started | KEEP | 第二個案件用 `legacy_request(new)` |
| test_access_link_without_origin_and_for_closed_cases | SETUP | book_slot |
| test_history_records_actor_source_changes_and_reasons | KEEP | 改用 book_slot：`created` 事件 after.status 為 `confirmed`；「確認」事件段改用 `legacy_request(new)`→`/confirm` |
| test_parent_and_system_actions_are_attributed | KEEP | 家長取消段 book_slot＋`open_manage`；逾期段 `legacy_request(pending, 已過期 hold)`＋`expire_holds` |
| test_retention_clears_history_and_reject_reasons | SETUP | `legacy_reschedule_request` 造申請後 reject |
| test_parent_reschedule_request_notifies_and_shows_details | OBSOLETE | 刪（A4／A5 的新測試涵蓋家長改期通知） |
| test_approving_records_resolver_and_closing_the_case_withdraws_requests | SETUP | `legacy_reschedule_request` |
| test_rejecting_records_reason_and_resolver | SETUP | 同上 |
| test_reschedule_requests_stay_inside_campus_scope | SETUP | 同上 |
| test_staff_reschedule_withdraws_the_parents_pending_request | SETUP | 同上 |
| test_pending_reschedules_without_campus_cover_every_visible_campus | SETUP | 同上 |
| test_migration_closes_requests_superseded_by_staff_reschedule | SETUP | 同上 |

### test_parent_access.py
`_enable_slots_and_book` 改用 `book_slot`。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_parent_can_exchange_token_and_read_own_request | SETUP | `reschedule_pending` 斷言保留（欄位仍在） |
| test_parent_mutation_refuses_request_switched_in_another_tab | OBSOLETE→改 | 改期段改打 `POST /public/visit-manage/reschedule`（body `{visit_request_id, slot_id}`），仍 409 PARENT_SESSION_CHANGED；刪 `/admin/reschedule-requests == []` 斷言，改成「兩筆案件的 slot 都沒變」 |
| test_parent_mutations_without_visit_request_id_still_work_for_old_pages | OBSOLETE→改 | 刪改期段，保留取消段 |
| test_parent_reschedule_request_does_not_move_slot_until_approved | OBSOLETE | 刪（A5 `test_parent_reschedules_directly` 取代） |
| test_parent_mutations_require_non_simple_request_header | OBSOLETE→改 | parametrize 路徑 `reschedule-request` 換成 `reschedule`，另加 `PATCH me` |
| test_parent_change_deadline_is_enforced_by_api | OBSOLETE→改 | 改打新端點 `reschedule` 與 `PATCH me` |
| test_parent_page_keeps_inactive_campus_name_and_phone | OBSOLETE→改 | 改期段改打新端點，仍 409 BOOKING_UNAVAILABLE |
| 其他用 `phone_masked` 斷言者 | SETUP | 改斷言 `phone` |

### test_reception_handling.py
helper `_manual_case` 補 slot_id；模組 docstring 刪「轉聯絡中」。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_reception_handles_a_case_end_to_end | SETUP | 刪 `/contacting` 步驟；`legacy_request(new)`→`/confirm`；取消案用 book_slot |
| test_reception_cannot_touch_schedule_settings_or_assignments | SETUP | 補登帶 slot |
| test_reception_stays_inside_own_campus | SETUP | 補登帶 slot；確認 404 先於 422 |
| test_reception_decides_parent_reschedule_requests | SETUP | `legacy_reschedule_request` |
| test_reception_sees_notifications_but_only_managers_mark_them_handled | SETUP | book_slot |
| test_reception_is_an_assignable_handler | SETUP | `legacy_request(new)` |

### test_visit_manual_workflow.py
helper `_manual`／`_create` 補 slot_id。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_contacting_then_confirm_then_complete | OBSOLETE→改 | `legacy_request(contacting)`→`/confirm`→`start_visit_slot`→`/complete` |
| test_pending_returned_to_contacting_releases_slot | OBSOLETE | 刪 |
| test_rebooking_links_previous_case_and_cross_campus_needs_super_admin | SETUP | 補登帶各校自己的 slot |
| test_created_date_filter | SETUP | 同上 |

### test_visit_manual_and_assign.py
helper `_manual` 補 slot_id。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_manual_intake_creates_new_case_even_when_online_booking_paused | OBSOLETE→改 | paused 下補登帶 slot → `confirmed`；保留「不記 analytics／不發『新需求』通知」斷言，並斷言有 `parent_visit_booked`（有 Email 時） |
| test_manual_intake_retry_returns_same_case | SETUP | capacity ≥ 2 |
| test_manual_intake_key_cannot_collide_with_public_form_key | SETUP | book_slot＋補登帶 slot |
| test_manual_intake_validates_input | SETUP | 補 slot_id；另加「缺 slot_id → 422」 |
| test_campus_admin_cannot_manually_create_for_other_campus | SETUP | 各校自己的 slot |
| test_assign_and_filter_by_assignee | SETUP | `legacy_request(new)` |
| test_cannot_assign_to_staff_without_campus_scope_or_inactive | SETUP | 同上 |
| test_confirm_keeps_existing_assignee | KEEP | `legacy_request(new)` |
| test_complete_only_from_confirmed | SETUP | `legacy_request(new)` |

### test_audit_actions.py
| 測試 | 分類 | 做法 |
|---|---|---|
| test_case_transitions_and_contact_notes_are_audited | SETUP | `legacy_request(new)`；刪 contacting 段；confirm 的 `from_status` 改 `"new"` |
| test_cancel_and_no_show_are_audited_without_reason_text | SETUP | cancel 案 `legacy_request(new)`；no_show 案 book_slot |
| test_transition_already_done_by_someone_else_is_not_audited | SETUP | 刪 contacting 段 |
| test_transition_audit_uses_status_read_under_lock | OBSOLETE→改 | 「對方改狀態」改用 `workflow_service.cancel`，`from_status` 改對應值 |
| test_reschedule_request_decisions_are_audited | SETUP | `legacy_reschedule_request` |

### test_visit_details.py
helper `_enable_inquiry` 刪；`_create_details` 改 book_slot（帶 child_name／email／referral）；`_pending_last_slot` 改 `legacy_request(pending, last slot, hold)`；`_payload` 補 slot_id／email。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_new_optional_defaults_preserve_legacy_payload_hash | SETUP | `_payload` 補 slot_id／email，hash 期望值重算 |
| test_details_normalize_names_email_and_referral_order | SETUP | 同上 |
| test_invalid_details_are_rejected | SETUP | 同上（否則假綠） |
| test_birthdate_uses_taipei_today_at_utc_day_boundary | SETUP | 同上 |
| test_new_details_roundtrip_stays_private_and_within_campus | SETUP | book_slot；status 改 `confirmed`；outbox 數改為實際值（含 confirmed 與 parent_visit_booked） |
| test_legacy_replay_accepts_omitted_or_empty_new_details | OBSOLETE | 刪 |
| test_details_replay_deduplicates_sources_but_rejects_changed_child | SETUP | book_slot |
| test_csv_includes_details_and_slot_with_formula_protection | SETUP | book_slot，刪 `/confirm` |
| test_retention_clears_new_details_and_audit_rejects_personal_fields | SETUP | book_slot |
| test_pending_can_confirm_own_last_slot_without_opening_capacity | KEEP | `legacy_request(pending)` |
| test_pending_cannot_confirm_into_another_familys_full_slot | KEEP | 同上 |
| test_expired_pending_hold_cannot_be_confirmed_before_or_after_sweep | KEEP | 同上；刪 `slots_auto_confirm is False` 斷言 |

### test_booking_concurrency.py
helper `_payload` 補 slot_id；`_last_slot_payload` 刪 `slots_auto_confirm=False`；`_assert_one_booking_same_receipt` 斷言改 `"confirmed"`。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_concurrent_identical_submissions_create_only_one_request | SETUP | slots＋slot |
| test_many_concurrent_identical_submissions_still_one_request | SETUP | 同上 |
| test_concurrent_replay_waiting_on_lock_gets_receipt_not_slot_full | SETUP | 斷言 `confirmed` |
| test_concurrent_replay_prechecked_after_first_commit_gets_receipt | SETUP | 同上 |
| test_parallel_reschedule_requests_for_one_visit_leave_one_pending | OBSOLETE | 刪（A5 的最後名額競態測試取代） |

### test_booking_consent_readiness.py
helper `_form` 補 slot_id／email。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_submission_records_consent_revision_and_server_time | SETUP | slots＋slot |
| test_missing_or_outdated_consent_version_is_rejected | SETUP | 同上 |
| test_republish_without_consent_change_keeps_filled_forms_valid | SETUP | 同上 |
| test_replay_returns_original_case_even_after_consent_changes | SETUP | 同上 |
| test_form_modes_reject_submissions_without_a_published_consent | SETUP | DB 寫 `BookingMode.SLOTS`；斷言公開端 `mode == "paused"` |
| test_manual_case_has_no_consent_version_but_records_time | SETUP | 補登帶 slot |
| test_form_modes_need_a_published_consent | SETUP | 刪 inquiry 段，保留 slots 段 |
| test_readiness_lists_blockers_and_impact | SETUP | 刪 `blockers["inquiry"]` 與切 inquiry；new／contacting 用 `legacy_request` 造 |
| test_config_audit_records_full_before_and_after | SETUP | 目標模式改 phone；快照不含 `slots_auto_confirm` |
| test_party_size_is_required_validated_and_exported | SETUP | slots；補登帶 slot（capacity 夠） |
| test_legacy_case_without_party_size_exports_blank | KEEP | `legacy_request(new, party_size=None)` |
| test_questions_are_limited_to_500_characters | SETUP | slots；補登帶 slot |

### test_bugfix_regressions.py
helper `_enable_slots(auto_confirm)` 去參數；`_payload` 補 email（經 ParentClient 可省）。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_slots_manual_confirmation_is_the_default | OBSOLETE→改 | 改名 `test_slots_submission_is_confirmed_without_hold`：送單得 `confirmed`、`hold_expires_at is None` |
| test_pending_confirmation_occupies_capacity | KEEP | 第一筆 `legacy_request(pending, slot, 未到期 hold)`，他家送單 → SLOT_FULL |
| test_expired_hold_is_cancelled_and_releases_capacity | KEEP | 第一筆 `legacy_request(pending, 已過期 hold)` |
| test_reschedule_request_validates_slot | OBSOLETE→改 | 改打 `POST /public/visit-manage/reschedule`：不存在 404 SLOT_NOT_FOUND、他校 404、同場次 409 SAME_SLOT |
| test_duplicate_pending_reschedule_request_is_rejected | OBSOLETE | 刪 |
| test_approving_reschedule_for_cancelled_request_is_409_not_500 | SETUP | `legacy_reschedule_request` 後取消案件再 approve → 409 |

### test_notifications.py
helper `_enable_inquiry_and_submit` → 改名 `_book_and_get_id`，內部用 book_slot（`test_notification_retry_reminders.py` 會 import，一起改名）。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_mail_failure_does_not_lose_request | SETUP | 斷言 `status == "confirmed"` |
| test_failed_job_is_retried_and_succeeds_later | SETUP | book_slot（注意 outbox 多了 `visit_request_confirmed` 與 `parent_visit_booked`，計數要跟著改） |
| test_max_attempts_marks_failed_for_manual_retry | SETUP | 同上 |
| test_worker_crash_lease_recovers | SETUP | 同上 |
| test_notification_inbox_scoped_by_campus | SETUP | 同上 |
| test_inactive_user_excluded_from_recipients | SETUP | 同上 |

### test_notification_email.py
| 測試 | 分類 | 做法 |
|---|---|---|
| test_reception_receives_new_request_mail | OBSOLETE→改 | book_slot；園方信主旨 `[常春藤官網] 義華校｜新的參觀需求`（`visit_request_created` 仍會排）；內文改為含「參觀時段」；個資仍不得出現；家長信另由 A4 測 |
| test_slot_request_mail_includes_visit_time | OBSOLETE→改 | 預期主旨改 `…｜參觀預約已確認`，不再有「待園方確認」 |

### test_notification_retry_reminders.py
| 測試 | 分類 | 做法 |
|---|---|---|
| test_failed_notification_listed_and_retry_only_resends_missing_channels | SETUP | book_slot；只看園方 kind（用 `kind=` 篩）以免家長信干擾計數 |
| test_batch_retry_skips_other_campus_and_non_failed | SETUP | 同上 |
| test_cli_requeue_respects_campus | SETUP | 同上 |
| test_dashboard_failed_count_matches_outbox_list | SETUP | 同上 |
| test_outbox_list_reports_total_beyond_limit | SETUP | book_slot×3（不同手機、capacity 夠） |
| test_new_request_overdue_reminded_once_and_skipped_once_handled | KEEP | `legacy_request(new)`×2；「有人處理」改用新增聯絡紀錄或 `/confirm` |
| test_manual_request_is_not_reported_overdue | KEEP | `legacy_request(new, source="phone")` |
| test_new_request_with_contact_note_is_not_reported_overdue | KEEP | `legacy_request(new)`×2 |
| test_hold_expiring_reminder | KEEP | `legacy_request(pending, hold_expires_at=…)` |
| test_short_hold_is_not_reminded | KEEP | 同上 |
| test_maintenance_cycle_enqueues_and_sends_reminders | KEEP | `legacy_request(new)` |

### test_operations.py
helper `_submit_inquiry` → book_slot。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_request_created_event_recorded_internally | SETUP | book_slot |
| test_dashboard_scoped_by_campus_no_cross_campus_leak | SETUP | 同上 |
| test_export_visit_requests_does_not_leak_other_campus | SETUP | 同上 |
| test_audit_log_records_booking_config_before_and_after | SETUP | 快照不含 `slots_auto_confirm` |
| test_retention_dry_run_does_not_modify_data | SETUP | book_slot 後取消 |
| test_retention_real_run_disabled_by_default | SETUP | book_slot |
| test_retention_does_not_touch_active_requests | SETUP | `legacy_request(new)` 與 book_slot 各一 |
| test_dashboard_lists_today_visits_and_draft_kinds | SETUP | `legacy_request(confirmed, slot_id=今天的 slot)` |

### test_analytics_funnel.py
| 測試 | 分類 | 做法 |
|---|---|---|
| test_cancellations_are_recorded_with_reason | KEEP | staff 段 book_slot＋後台取消；parent 段 book_slot＋`open_manage`＋家長取消；hold_expired 段 `legacy_request(pending, 已過期)`＋`expire_holds`；另斷言 `visit_requests.cancel_reason` 三種值 |
| test_funnel_groups_by_source_and_referral | SETUP | book_slot×2；補登帶 slot（補登不算 request_created） |

### test_security_hardening.py
helper `_payload`（被 test_maintenance、retry_reminders import）補 slot_id 必填。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_expired_hold_does_not_occupy_capacity_before_cleanup | KEEP | `legacy_request(pending, 已過期)`；第二個家長 book_slot 同 slot 仍 201 |
| test_process_notifications_releases_holds_without_email_sink | KEEP | 同上 |
| test_concurrent_reschedule_requests_serialize_on_visit_request | OBSOLETE | 刪 |
| test_dashboard_failed_notifications_are_campus_scoped | SETUP | 兩校 book_slot |

### test_maintenance.py
helper `_expired_hold` → `legacy_request(status="pending_confirmation", slot_id=…, hold_expires_at=過去)`。
| 測試 | 分類 | 做法 |
|---|---|---|
| test_cycle_releases_holds_and_writes_inbox_even_without_email | KEEP | 如上 |
| test_a_failing_step_does_not_block_the_others | KEEP | 如上 |
| test_slow_smtp_does_not_block_the_event_loop | KEEP | 如上；刪「先消化建立案件通知」那行 |
| test_stale_backlog_writes_inbox_but_does_not_email | KEEP | `legacy_request(pending)` 後先跑 `expire_holds` 才有 hold_expired outbox |

### test_line_notifications.py
六個測試都經 `from tests.test_maintenance import _expired_hold`，測的是 LINE 推播，不是占位釋放 → 全部改用 book_slot（要有 outbox）：test_outbox_pushes_to_campus_group_once、test_outbox_retries_failed_push_with_same_retry_key、test_line_failure_does_not_block_email、test_outbox_skips_line_when_campus_has_no_group、test_outbox_skips_group_the_bot_has_left、test_maintenance_cycle_pushes_when_line_is_configured。LINE 只推園方 kind，家長 kind 不推（A4 保證），計數以園方 kind 為準。

### 其他小檔
| 檔案 | 測試 | 分類 | 做法 |
|---|---|---|---|
| test_edit_versions.py | test_assignee_and_follow_up_use_case_version | SETUP | helper `_case` → `legacy_request(new)`（version=1）；「狀態轉換不動版本」改用 `/confirm` 驗 |
| test_display_names.py | test_visit_staff_notes_and_history_carry_display_names | SETUP | 補登帶 slot |
| test_retention_policy.py | test_closing_time_decides_expiry_and_open_cases_are_only_counted | SETUP | cancelled／completed／no_show 用 `legacy_request(該狀態)`；stale_new、fresh_new 用 `legacy_request(new)`（open_overdue 仍為 2） |
| test_retention_policy.py | test_manual_run_anonymizes_closed_cases_and_is_recorded | SETUP | stale 用 `legacy_request(new)` |
| test_retention_policy.py | test_scheduled_run_needs_policy_and_deployment_flag_once_per_day | SETUP | legacy_request |
| test_visit_attention_export.py | test_needs_attention_lists_closed_slots_holidays_and_inactive_campuses | SETUP | `_confirmed` 改補登帶 slot；`minghua_new` 用 `legacy_request(new)`；**注意 A7 起手動停止申請不再列入待人工處理**：原本斷言「關閉時段上的案件要人工處理」要改成用休假日造 |
| test_visit_attention_export.py | test_export_header_has_each_column_once | SETUP | 補登帶 slot |
| test_visit_attention_export.py | test_export_applies_screen_filters_and_audits_them | SETUP | 王媽媽 book_slot；李、張用 `legacy_request(new, source=line／walk_in)` |
| test_request_id_and_error_codes.py | test_admin_confirm_and_reschedule_into_closed_slot | KEEP | `legacy_request(new)` |
| test_campus_status_media_tags.py | test_deactivate_campus_stops_public_booking_and_keeps_cases | SETUP | slots＋補登帶 slot（status `confirmed`）；末尾 mode 斷言改 `"slots"` |
| test_visit_option_codes.py | test_contact_time_codes_and_legacy_labels、test_age_codes_and_legacy_labels、test_unknown_values_rejected | SETUP | `_base` 補 slot_id／email；`VisitRequestManualCreate` 也補 slot_id |
| test_visit_option_codes.py | test_submission_stores_code_and_label_retry_is_same_request | SETUP | slots＋slot |
| test_visit_schedule.py | 斷言「PUT 後場次交給下一輪定期工作補」的測試 | SETUP | A7 起 PUT 會立即補場次，改斷言 `slot_sync.created` |
