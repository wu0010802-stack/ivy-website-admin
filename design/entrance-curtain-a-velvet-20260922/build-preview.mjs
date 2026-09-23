import { build } from '../../web/node_modules/esbuild/lib/main.js'
import { writeFile } from 'node:fs/promises'

const result = await build({ stdin: { contents: "export { createEntranceCurtain } from './entranceCurtain'; export { entranceTimeline, ENTRANCE_DURATION } from './entrance-timeline'", resolveDir: new URL('../../web/app/utils/', import.meta.url).pathname }, bundle: true, external: ['three'], write: false, format: 'esm', target: 'es2022' })
await writeFile(new URL('./velvet.js', import.meta.url), '// Generated from web/app/utils/entranceCurtain.ts\n' + result.outputFiles[0].text.replaceAll('from "three"', 'from "../../web/node_modules/three/build/three.module.js"'))
