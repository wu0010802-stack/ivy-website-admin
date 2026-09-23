import { transform } from '../../web/node_modules/esbuild/lib/main.js'
import { readFile, writeFile } from 'node:fs/promises'

const source = await readFile(new URL('../../web/app/utils/entranceCurtain.ts', import.meta.url), 'utf8')
const result = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })
await writeFile(new URL('./velvet.js', import.meta.url), '// Generated from web/app/utils/entranceCurtain.ts\n' + result.code.replace('from "three"', 'from "../../web/node_modules/three/build/three.module.js"'))
