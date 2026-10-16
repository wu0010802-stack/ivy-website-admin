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

/** 附近同業收費（2026-10-15）：stack 用檔案匯入，不會抓收費檔，這裡直接寫。崇德北方加三所私立同業；
 *  本校 2–4 歲、準公共、公立各一筆收費；收費狀態列 114 學年；三所托嬰補月費、評鑑、準公共。可以重跑。 */
export function seedPeerFees(): void {
  psql(
    `INSERT INTO geo_kindergartens (source_id, name, kind, district, address, lat, lng, approved_capacity, has_penalty, is_active, synced_at)
     VALUES ('e2e-kg-p1', '高雄市私立測試己幼兒園', 'private', '左營區', '測試路11號', 22.676662, 120.307197, 100, false, true, now()),
            ('e2e-kg-p2', '高雄市私立測試庚幼兒園', 'private', '左營區', '測試路12號', 22.678662, 120.307197, 100, false, true, now()),
            ('e2e-kg-p3', '高雄市私立測試辛幼兒園', 'private', '左營區', '測試路13號', 22.680662, 120.307197, 100, false, true, now())
     ON CONFLICT (source_id) DO NOTHING;
     INSERT INTO geo_kindergarten_fees (source_id, age, school_year, months, tuition, misc_fee, materials, activities, lunch, snack, semester_total, after_care_monthly, transport_note, synced_at)
     VALUES ('e2e-kg-own', 2, 114, 5.5, 21800, 5500, 31900, 30250, 8250, 8250, 105950, 1200, '單 770 雙 1540', now()),
            ('e2e-kg-own', 3, 114, 5.5, 19900, 5500, 24750, 23100, 8250, 8250, 89750, 1200, '單 770 雙 1540', now()),
            ('e2e-kg-own', 4, 114, 5.5, 19900, 5500, 20000, 23100, 8250, 8250, 85000, 1200, NULL, now()),
            ('e2e-kg-p1', 3, 114, 5.5, 15000, 20000, 11000, 9900, 7500, 6600, 70000, 1200, NULL, now()),
            ('e2e-kg-p2', 3, 114, 5.5, 16000, 21300, 15000, 12000, 8000, 7700, 80000, 1500, NULL, now()),
            ('e2e-kg-p3', 3, 114, 5.5, 20000, 25000, 20000, 15000, 8000, 7000, 95000, 1800, NULL, now()),
            ('e2e-kg-p1', 4, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 60000, NULL, NULL, now()),
            ('e2e-kg-p2', 4, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 65000, NULL, NULL, now()),
            ('e2e-kg-p3', 4, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 70000, NULL, NULL, now()),
            ('e2e-kg-quasi', 3, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 63190, NULL, NULL, now()),
            ('e2e-kg-public', 3, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 17965, NULL, NULL, now())
     ON CONFLICT DO NOTHING;
     INSERT INTO geo_dataset_status (dataset, active_version, label, synced_at, checked_at)
     VALUES ('kindergarten_fees', '114', '114', now(), now())
     ON CONFLICT (dataset) DO UPDATE SET active_version = '114', label = '114', synced_at = now(), checked_at = now(), last_error = NULL;
     UPDATE geo_babycare SET monthly_fee = 17900, evaluation_grade = '優等', evaluation_year = 114, quasi_public = true, fee_note = '平均月費: 17,900元' WHERE source_id = 'e2e-bc-near';
     UPDATE geo_babycare SET monthly_fee = 15000, quasi_public = true WHERE source_id = 'e2e-bc-home';
     UPDATE geo_babycare SET monthly_fee = 21000, evaluation_grade = '乙等', quasi_public = false WHERE source_id = 'e2e-bc-mid';`,
    {},
  )
}

// 每個里每月出生數，從最新一期往回：2、2、3、3、4、4（出生走勢 e2e，2026-10-14）。
const BIRTH_PERIOD_COUNTS = [2, 2, 3, 3, 4, 4]

function birthSeriesMonths(): { month: string; perVillage: number }[] {
  const months: { month: string; perVillage: number }[] = []
  for (let period = 0; period < BIRTH_PERIOD_COUNTS.length; period++) {
    for (let offset = 0; offset < 12; offset++) {
      // 115-09 往回第 (period × 12 + offset) 個月。
      const total = 115 * 12 + 9 - 1 - (period * 12 + offset)
      const month = `${String(Math.floor(total / 12)).padStart(3, '0')}-${String((total % 12) + 1).padStart(2, '0')}`
      if (month === '111-03') continue // 來源兩個資料集都查無的月份：留成缺月
      months.push({ month, perVillage: BIRTH_PERIOD_COUNTS[period]! })
    }
  }
  return months
}

/**
 * 近幾年的出生數（2026-10-14）：stack 啟動時只匯入各里人口，沒有出生歷史；要看有內容的畫面只能直接寫測試庫。
 * 每個里（沿用已匯入的 893 里）寫 71 個月（109-10 到 115-09，缺 111-03）、每月 2／2／3／3／4／4 位（每期一個數字，
 * 從最新往回），並寫出生的狀態列（最新月份 115-09）。重複執行不會重複。
 */
export function seedBirthSeries(): void {
  const values = birthSeriesMonths()
    .map(({ month, perVillage }) => `('${month}', ${perVillage})`)
    .join(', ')
  psql(
    `INSERT INTO geo_village_births (month, village_code, district, village, births)
     SELECT m.month, p.village_code, p.district, p.village, m.per_village
       FROM geo_village_population AS p CROSS JOIN (VALUES ${values}) AS m(month, per_village)
     ON CONFLICT (month, village_code) DO NOTHING;
     INSERT INTO geo_dataset_status (dataset, active_version, label, synced_at, checked_at)
     VALUES ('births', '115-09', '115-09', now(), now())
     ON CONFLICT (dataset) DO UPDATE SET active_version = '115-09', label = '115-09';`,
    {},
  )
}

// 預約全程（2026-10-15）：用 renwu 校區寫一批預約案件、場次、事件與招生訪視，日期相對台北今天。
// 標記：家長姓名與幼生姓名都以「E2E旅程」開頭，clearJourney 靠它清；每筆預約送出日＝場次日 − 7。
export const JOURNEY_CAMPUS = 'renwu'
const JOURNEY_MARK = 'E2E旅程'

/** 民國月份「115.09」（recruitment_visits.month）：同後端 academic.roc_month。 */
const rocMonth = (dayExpr: string): string => `((extract(year from ${dayExpr})::int - 1911)::text || '.' || to_char(${dayExpr}, 'MM'))`

/** 台北今天往前推 n 天的日期運算式（SQL）。 */
const day = (n: number): string => `((now() AT TIME ZONE 'Asia/Taipei')::date - ${n})`
/** 台北某天的牆上時間（timestamptz，SQL）。 */
const at = (n: number, time = '12:00'): string => `((${day(n)} + time '${time}') AT TIME ZONE 'Asia/Taipei')`

interface JourneyCase {
  tag: string
  status: 'completed' | 'no_show' | 'cancelled'
  slotDays: number
  cancelledDays?: number
  cancelReason?: 'parent' | 'staff'
  visit?: { deposited?: boolean; depositEventDays?: number; enrolledDays?: number; withdrawnDays?: number }
}

const JOURNEY_CASES: JourneyCase[] = [
  { tag: 'A', status: 'completed', slotDays: 30, visit: { deposited: true, depositEventDays: 20, enrolledDays: 10 } },
  { tag: 'B', status: 'completed', slotDays: 25, visit: {} },
  { tag: 'C', status: 'completed', slotDays: 5, visit: {} },
  { tag: 'D', status: 'completed', slotDays: 15 },
  { tag: 'E', status: 'no_show', slotDays: 12 },
  { tag: 'F', status: 'cancelled', slotDays: 9, cancelledDays: 9, cancelReason: 'parent' },
  { tag: 'G', status: 'cancelled', slotDays: 8, cancelledDays: 12, cancelReason: 'staff' },
  { tag: 'H', status: 'completed', slotDays: 40, visit: { deposited: true, depositEventDays: 35, withdrawnDays: 20 } },
]

function journeyStatements(): string {
  const parts: string[] = []
  for (const item of JOURNEY_CASES) {
    const name = `${JOURNEY_MARK}${item.tag}`
    parts.push(`
      WITH slot AS (
        INSERT INTO visit_slots (id, campus_key, slot_date, start_time, end_time, capacity, closed, version, from_rule, created_at)
        VALUES (gen_random_uuid(), '${JOURNEY_CAMPUS}', ${day(item.slotDays)}, time '10:00', time '11:00', 99, false, 1, false, now())
        RETURNING id
      ), request AS (
        INSERT INTO visit_requests (id, campus_key, idempotency_key, payload_hash, config_version, parent_name, phone,
                                    consent_given, status, source, slot_id, created_at, cancelled_at, cancel_reason, version)
        SELECT gen_random_uuid(), '${JOURNEY_CAMPUS}', 'e2e-journey-${item.tag}-' || gen_random_uuid()::text, repeat('0', 64), 0,
               '${name}', '0911000444', true, '${item.status}', 'web', slot.id, ${at(item.slotDays + 7, '09:00')},
               ${item.cancelledDays === undefined ? 'NULL' : at(item.cancelledDays, '08:00')},
               ${item.cancelReason ? `'${item.cancelReason}'` : 'NULL'}, 1
          FROM slot
        RETURNING id
      )
      ${
        item.visit
          ? `, visit AS (
        INSERT INTO recruitment_visits (id, campus_key, visit_request_id, month, visit_date, child_name, has_deposit, rides_bus, enrolled,
                                        enrolled_on, withdrawn_at, withdrawn_from, withdraw_reason, transfer_term, version, created_at, updated_at)
        SELECT gen_random_uuid(), '${JOURNEY_CAMPUS}', request.id, ${rocMonth(day(item.slotDays))}, ${day(item.slotDays)},
               '${name}', ${item.visit.deposited ? 'true' : 'false'}, false, ${item.visit.enrolledDays === undefined ? 'false' : 'true'},
               ${item.visit.enrolledDays === undefined ? 'NULL' : day(item.visit.enrolledDays)},
               ${item.visit.withdrawnDays === undefined ? 'NULL' : at(item.visit.withdrawnDays)},
               ${item.visit.withdrawnDays === undefined ? 'NULL' : `'deposited'`},
               ${item.visit.withdrawnDays === undefined ? 'NULL' : `'E2E旅程退出'`}, false, 1, now(), now()
          FROM request
        RETURNING id
      )
      ${
        item.visit.depositEventDays === undefined
          ? 'SELECT 1'
          : `INSERT INTO recruitment_event_log (id, recruitment_visit_id, event_type, to_stage, created_at)
      SELECT gen_random_uuid(), visit.id, 'deposit_added', 'deposited', ${at(item.visit.depositEventDays)} FROM visit`
      }`
          : 'SELECT 1'
      };`)
  }
  // 沒有預約案件的訪視（現場參觀）：參觀日 D−3。
  parts.push(`
    INSERT INTO recruitment_visits (id, campus_key, month, visit_date, child_name, has_deposit, rides_bus, enrolled, transfer_term, version, created_at, updated_at)
    VALUES (gen_random_uuid(), '${JOURNEY_CAMPUS}', ${rocMonth(day(3))}, ${day(3)}, '${JOURNEY_MARK}現場', false, false, false, false, 1, now(), now());`)
  return parts.join('\n')
}

/** 清除預約全程的種子（重複執行無害）。順序：訪視（連事件）→ 預約（連事件）→ 場次。 */
export function clearJourney(): void {
  psql(
    `CREATE TEMP TABLE journey_slots AS
       SELECT DISTINCT slot_id FROM visit_requests WHERE parent_name LIKE '${JOURNEY_MARK}%' AND slot_id IS NOT NULL;
     DELETE FROM recruitment_visits WHERE child_name LIKE '${JOURNEY_MARK}%';
     DELETE FROM visit_requests WHERE parent_name LIKE '${JOURNEY_MARK}%';
     DELETE FROM visit_slots WHERE id IN (SELECT slot_id FROM journey_slots);`,
    {},
  )
}

/**
 * 先清再寫，所以重複執行不會重複。回傳寫入前這一校已經存在的「沒有預約案件的招生訪視」筆數（參觀日在最近 90 天，
 * 也就是頁面預設期間，不含種子自己）：別的 spec 可能在同一校留下訪視（例如 admissions-area 在 renwu 建的），
 * 涵蓋說明的筆數要以它為基準。
 */
export function seedJourney(): number {
  clearJourney()
  const others = psql(
    `SELECT count(*) FROM recruitment_visits
      WHERE campus_key = '${JOURNEY_CAMPUS}' AND visit_request_id IS NULL
        AND visit_date BETWEEN ${day(89)} AND ${day(0)} AND child_name NOT LIKE '${JOURNEY_MARK}%';`,
    {},
  )
  psql(journeyStatements(), {})
  return Number(others)
}

export type EnrolledSeed = readonly [lat: number, lng: number, grade: '幼幼班' | '小班' | '中班' | '大班', district: string, village: string]

/**
 * 在籍學生（2026-10-15）：正式站由 CLI 匯入本機比對的 JSON；e2e 不跑 CLI，直接寫兩張表（重複執行先清掉）。
 * points 的座標在這裡取到小數 3 位；streetOnly 位只對到里（沒有點）的小班。
 */
export function seedEnrolled(campus: string, points: readonly EnrolledSeed[], streetOnly: number): void {
  const rows = [
    ...points.map(([lat, lng, grade, district, village]) =>
      `(gen_random_uuid(), :'campus', '${grade}', '${district}', '${village}', 'exact', NULL, ${lat.toFixed(3)}, ${lng.toFixed(3)})`),
    ...Array.from({ length: streetOnly }, () => `(gen_random_uuid(), :'campus', '小班', '左營區', '新上里', 'street', NULL, NULL, NULL)`),
  ]
  psql(
    `DELETE FROM enrolled_rosters WHERE campus_key = :'campus';
     INSERT INTO enrolled_rosters (campus_key, roster_date, school_year, doorplate_version, total)
     VALUES (:'campus', DATE '2026-10-15', 115, '115-10', ${rows.length});
     INSERT INTO enrolled_student_points (id, campus_key, grade, district, village, match_level, unlocated_reason, lat, lng)
     VALUES ${rows.join(',\n')};`,
    { campus },
  )
}
