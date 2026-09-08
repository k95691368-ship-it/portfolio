import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8')

describe('Cloudflare 정적 배포 · Supabase 백엔드 경계', () => {
  it('프로덕션 API는 Supabase Edge Functions를 호출한다', () => {
    const client = read('src', 'api', 'client.js')
    expect(client).toContain('obumqkwkvnemkyaahjbn.supabase.co/functions/v1/api')
    expect(client).not.toContain('.supabase.co/server/v1/')
  })

  it('Cloudflare 설정에는 D1·R2·Worker 바인딩이 없다', () => {
    const wrangler = read('wrangler.toml')
    expect(wrangler).toContain('pages_build_output_dir = "dist"')
    expect(wrangler).not.toMatch(/\[\[d1_databases\]\]|\[\[r2_buckets\]\]|main\s*=/)
  })

  it('면접 녹화 업로드와 재생에 필요한 Supabase 호스트만 CSP에 연다', () => {
    const vite = read('vite.config.js')
    expect(vite).toContain('https://obumqkwkvnemkyaahjbn.storage.supabase.co')
    expect(vite).toContain('wss://obumqkwkvnemkyaahjbn.supabase.co')
    expect(vite).toContain("media-src 'self' blob: ${SUPABASE.media.join(' ')}")
  })

  it('Edge 라우팅 중 POST 본문과 요청 방식을 보존한다', () => {
    const edge = read('supabase', 'functions', 'api', 'index.ts')
    expect(edge).toContain('method: request.method')
    expect(edge).toContain('init.body = request.body')
    expect(edge).not.toContain('{ ...request, headers }')
  })

  it('교차 출처 API에는 쿠키 대신 앱 전용 토큰만 보낸다', () => {
    const client = read('src', 'api', 'client.js')
    expect(client).toContain("credentials: 'omit'")
    expect(client).not.toContain("credentials: 'include'")
    expect(client).toContain("headers['X-App-Authorization'] = `Bearer ${account.token}`")
  })
})
