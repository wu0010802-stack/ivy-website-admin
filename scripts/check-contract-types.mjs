// contract:check 用：重新產生型別到暫存檔，跟目前 commit 的
// contracts/generated/website-api.d.ts 比對，不同就視為 drift。
// （openapi.json 本身的一致性由 backend/scripts/export_openapi.py --check 負責。）
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TRACKED = 'contracts/generated/website-api.d.ts'
const TMP = 'contracts/generated/.website-api.check.d.ts'

execSync(`npx openapi-typescript contracts/openapi.json -o ${TMP}`, { stdio: 'inherit' })

const tracked = readFileSync(TRACKED, 'utf8')
const fresh = readFileSync(TMP, 'utf8')

execSync(`rm -f ${TMP}`)

if (tracked !== fresh) {
  console.error(
    `契約型別已過期：${TRACKED} 與目前 openapi.json 不一致，請執行 npm run contract:generate`
  )
  process.exit(1)
}
console.log('契約型別與 openapi.json 一致')
