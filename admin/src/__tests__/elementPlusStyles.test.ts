/// <reference types="node" />
// Element Plus 樣式只載入用到的元件（src/element-plus.css，2026-10-20 起取代整包 index.css）：
// 模板新用到一個 <el-*>（或 v-loading、ElMessage 這類服務）卻沒補它的 CSS，畫面會少樣式而測試照過，
// 這裡掃整個 src，沿 element-plus/es/components/〈元件〉/style/css.mjs 的依賴算出要的 CSS，和清單比對。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const EP = join(SRC, '../node_modules/element-plus')

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
    return /\.(ts|vue)$/.test(entry.name) ? [path] : []
  })
}

// ElMessage → message、ElMessageBox → message-box。
const kebab = (name: string) => name.replace(/[A-Z]/g, (c, i: number) => (i ? '-' : '') + c.toLowerCase())

function usedComponents(): Set<string> {
  const used = new Set<string>()
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/<el-([a-z0-9-]+)/g)) used.add(m[1]!)
    if (/\sv-loading\b/.test(text)) used.add('loading')
    for (const m of text.matchAll(/import \{([^}]*)\} from 'element-plus'/g)) {
      for (const name of m[1]!.split(',').map((s) => s.trim())) {
        const match = /^El([A-Z][A-Za-z]+)$/.exec(name)
        if (match) used.add(kebab(match[1]!))
      }
    }
  }
  return used
}

function requiredCss(components: Iterable<string>): Set<string> {
  const css = new Set<string>()
  const seen = new Set<string>()
  const visit = (component: string) => {
    if (seen.has(component)) return
    seen.add(component)
    const file = join(EP, 'es/components', component, 'style/css.mjs')
    if (!existsSync(file)) throw new Error(`找不到 ${component} 的樣式依賴（${file}）`)
    for (const m of readFileSync(file, 'utf8').matchAll(/import "([^"]+)"/g)) {
      const spec = m[1]!
      if (spec.startsWith('element-plus/theme-chalk/')) css.add(spec.slice('element-plus/theme-chalk/'.length))
      else visit(basename(dirname(dirname(spec))))
    }
  }
  for (const component of components) visit(component)
  return css
}

const imported = [...readFileSync(join(SRC, 'element-plus.css'), 'utf8').matchAll(/@import 'element-plus\/theme-chalk\/([a-z0-9-]+\.css)';/g)].map((m) => m[1]!)

describe('Element Plus 樣式清單（src/element-plus.css）', () => {
  it('模板與程式用到的元件，連同依賴的 CSS 都在清單裡', () => {
    const used = usedComponents()
    expect(used.has('button')).toBe(true)
    expect(used.has('message-box')).toBe(true)
    const missing = [...requiredCss(used)].filter((file) => !imported.includes(file))
    expect(missing).toEqual([])
  })

  it('順序照整包 index.css（theme-chalk/src/index.scss），base.css 在最前面', () => {
    const order = [...readFileSync(join(EP, 'theme-chalk/src/index.scss'), 'utf8').matchAll(/@use '\.\/([a-z0-9-]+)(?:\.scss)?'/g)].map((m) => m[1]!)
    const rank = imported.map((file) => order.indexOf(file.replace(/^el-/, '').replace(/\.css$/, '')))
    expect(rank).not.toContain(-1)
    expect(rank).toEqual([...rank].sort((a, b) => a - b))
    expect(imported[0]).toBe('base.css')
  })

  it('main.ts 在 style.css 之前載入這份清單，不再整包 index.css', () => {
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8')
    expect(main).not.toContain('element-plus/dist/index.css')
    expect(main.indexOf("import './element-plus.css'")).toBeGreaterThan(-1)
    expect(main.indexOf("import './element-plus.css'")).toBeLessThan(main.indexOf("import './style.css'"))
  })
})
