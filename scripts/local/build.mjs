import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { build, mergeConfig } from 'vite'
import { build as bundle } from 'esbuild'
import config from '../../vite.config.js'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const buildDirectory = join(projectRoot, '.local-runtime')

export function offlineHtml(source) {
  return source.replace(/<link\b[^>]*>/gi, tag => {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] || ''
    return rel.split(/\s+/).some(value => ['preconnect', 'dns-prefetch'].includes(value.toLowerCase())) ? '' : tag
  })
}

export async function buildLocalApi(directory = buildDirectory) {
  await mkdir(directory, { recursive: true })
  const outfile = join(directory, 'api.mjs')
  await bundle({ entryPoints: [join(projectRoot, 'scripts/local/api.mjs')], outfile, bundle: true, platform: 'node',
    format: 'esm', target: 'node24', packages: 'external',
    define: { fetch: '__offlineFetch' },
    banner: { js: "const __offlineFetch = async () => { throw new Error('External requests are disabled in the local runtime'); };" },
    plugins: [{ name: 'offline-providers', setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)gmail\.js$/ }, () => ({ path: join(projectRoot, 'scripts/local/mail.mjs') }))
      builder.onResolve({ filter: /(?:^|\/)turn\.js$/ }, () => ({ path: join(projectRoot, 'scripts/local/turn.mjs') }))
    } }],
  })
  return outfile
}

export async function buildLocal() {
  await import('../generate-supabase-routes.mjs')
  await build(mergeConfig(config, { configFile: false, root: projectRoot, envDir: false, mode: 'offline',
    plugins: [{ name: 'offline-network-hints', transformIndexHtml: { order: 'pre', handler: offlineHtml } }],
    define: { 'import.meta.env.VITE_API_BASE': JSON.stringify('/api'), 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('local-offline') },
    build: { outDir: join(buildDirectory, 'site'), emptyOutDir: false },
  }))
  await buildLocalApi()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildLocal()
}
