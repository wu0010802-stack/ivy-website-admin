import { execFileSync } from 'node:child_process'
import { DB_NAME } from './stack-env'

// 直接改 E2E 拋棄式測試庫（start-api.sh 每次重建；名稱一定含 test）。只給「API 做不到、
// 也不該開 API 做」的測試前置用：場次已開始。連線吃 libpq 的環境變數（CI 的 PGHOST／PGUSER／
// PGPASSWORD，本機預設 socket），和 start-api.sh 的 createdb 一樣。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** SQL 從 stdin 給 psql，`:'name'` 由 psql 以字面值帶入（-c 不做變數代換）。回傳 -At 的輸出。 */
function psql(sql: string, vars: Record<string, string>): string {
  const args = ['-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-q', '-At']
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`)
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim()
}

/**
 * 同後端 tests/conftest.py 的 start_visit_slot：把這筆預約的場次移到昨天（台北），當成參觀已開始。
 * 公開預約只收還沒開始的場次，「已到場」又要等場次開始，所以先約未來場次再往前移。
 * 只改這筆預約獨占的場次；同一場還有別的預約就丟錯，不拖到其他測試。
 */
export function startVisitSlot(visitRequestId: string): void {
  if (!UUID.test(visitRequestId)) throw new Error(`不是預約 id：${visitRequestId}`)
  const moved = psql(
    `UPDATE visit_slots AS s
        SET slot_date = (now() AT TIME ZONE 'Asia/Taipei')::date - 1
       FROM visit_requests AS r
      WHERE r.id = :'visit_id'::uuid
        AND s.id = r.slot_id
        AND (SELECT count(*) FROM visit_requests AS other WHERE other.slot_id = s.id) = 1
  RETURNING s.id;`,
    { visit_id: visitRequestId },
  )
  if (!moved) throw new Error('場次沒有移動：預約沒有場次，或同一場還有別的預約')
}

/**
 * 參觀後追蹤（2026-10-04 規格 F19）：把這個孩子的招生訪視的下次聯絡移到一小時前，當成已到期。
 * 「下次聯絡」只能排在未來（API 會擋），要測到期只能直接改測試庫。只改一筆，對不到就丟錯。
 *
 * 下限取台北今天 00:00：台北 00–01 點時 now() - 1 小時會落在昨天，招生「今天要聯絡」的清單
 * 只看今天，會漏掉這筆（那段時間跑這支測試會紅）。
 */
export function makeFollowUpDue(childName: string): void {
  const moved = psql(
    `UPDATE recruitment_visits
        SET follow_up_at = GREATEST(
              now() - interval '1 hour',
              date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')
      WHERE child_name = :'child'
        AND follow_up_at IS NOT NULL
  RETURNING id;`,
    { child: childName },
  )
  if (moved.split('\n').filter(Boolean).length !== 1) throw new Error(`下次聯絡沒有移動：${childName}`)
}

/**
 * 附近園所的變化（2026-10-14）：同步一次只會建立基準，不會有異動；要看有內容的畫面只能直接寫測試庫。
 * 寫兩件事（重複執行不會重複）：一所已停辦的托嬰（5 天前的停辦事件）、崇德校附近一所幼兒園設立日改成 40 天前
 * （新設看設立日，不靠事件）。座標在崇德校 1 公里內。
 */
export function seedProviderChanges(): void {
  psql(
    `INSERT INTO geo_babycare (source_id, name, kind, address, lat, lng, approved_capacity, enrolled, phone, is_active, synced_at)
     VALUES ('e2e-bc-gone', '高雄市私立測試已停辦托嬰中心', 'center', '高雄市左營區測試路9號', 22.6745, 120.3085, 30, 0, NULL, false, now())
     ON CONFLICT (source_id) DO NOTHING;
     INSERT INTO geo_provider_events (provider, source_id, change, occurred_on)
     VALUES ('babycare', 'e2e-bc-gone', 'closed', (now() AT TIME ZONE 'Asia/Taipei')::date - 5)
     ON CONFLICT DO NOTHING;
     UPDATE geo_kindergartens
        SET registered_on = (now() AT TIME ZONE 'Asia/Taipei')::date - 40
      WHERE source_id = 'e2e-kg-quasi';`,
    {},
  )
}
