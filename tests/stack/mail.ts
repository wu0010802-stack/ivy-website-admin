import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { STATE_DIR } from './stack-env'

export interface SinkMail { to: string; subject: string; body: string; sent_at: string }

/** 讀 API 寫進本機 sink 資料夾的信（不會真的寄出）；背景工作約 10 秒一輪。 */
export async function readMail(filter: (mail: SinkMail) => boolean = () => true): Promise<SinkMail[]> {
  const dir = path.join(STATE_DIR, 'mail')
  const names = await readdir(dir).catch(() => [] as string[])
  const mails = await Promise.all(names.filter(n => n.endsWith('.json')).map(async n => JSON.parse(await readFile(path.join(dir, n), 'utf8')) as SinkMail))
  return mails.filter(filter).sort((a, b) => a.sent_at.localeCompare(b.sent_at))
}
