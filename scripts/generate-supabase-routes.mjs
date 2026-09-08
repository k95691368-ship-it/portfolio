import { readdir, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const root = process.cwd()
const apiRoot = join(root, 'server', 'api')
const output = join(root, 'supabase', 'functions', 'api', 'routes.generated.js')

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.name.endsWith('.js') && !entry.name.startsWith('_')) files.push(path)
  }
  return files
}

function routeFor(file) {
  const rel = relative(apiRoot, file).split(sep).join('/')
  const raw = rel.replace(/\.js$/, '').replace(/(?:^|\/)index$/, '') || '/'
  const segments = raw.split('/').filter(Boolean)
  const params = []
  let score = 0
  const pattern = segments.map((segment) => {
    const optional = segment.match(/^\[\[([A-Za-z0-9_]+)\]\]$/)
    if (optional) {
      params.push(optional[1])
      score -= 100
      return '(.*)'
    }
    const dynamic = segment.match(/^\[([A-Za-z0-9_]+)\]$/)
    if (dynamic) {
      params.push(dynamic[1])
      score += 10
      return '([^/]+)'
    }
    score += 100
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('\\/')
  return {
    rel,
    params,
    score,
    source: `^/${pattern}${segments.at(-1)?.startsWith('[[') ? '' : '/?'}$`,
  }
}

const routes = (await walk(apiRoot)).map(routeFor).sort((a, b) => b.score - a.score || b.rel.length - a.rel.length)
const imports = routes.map((route, index) => `import * as route${index} from '../../../server/api/${route.rel}'`)
const rows = routes.map((route, index) => `  { pattern: new RegExp(${JSON.stringify(route.source)}), params: ${JSON.stringify(route.params)}, module: route${index} },`)

await writeFile(output, `${imports.join('\n')}\n\nexport const routes = [\n${rows.join('\n')}\n]\n`)
console.log(`${output}: ${routes.length} routes`)
