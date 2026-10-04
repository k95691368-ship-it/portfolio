// @vitest-environment node
// 원본 수집 설정·저장소 목록·정지 확인. 병렬 실행을 위해 backupRecovery.test.js 에서 나눴다.
import { describe, expect, it, vi } from 'vitest'
import { lstat } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { sourceConfig, storageSource, acquireBackup, dumpPublicDatabase } from '../scripts/backup-recovery-lib.mjs'
import { main } from '../scripts/backup-recovery.mjs'
import { key, sql, pdf, entries, env, backupWorkspace } from './helpers/backupFixture.js'

const workspace = backupWorkspace()

describe('safe acquisition configuration', () => {
  it('keeps connection secrets in the subprocess environment, never arguments or URL output', () => {
    const config = sourceConfig(env)
    expect(config.pgEnv).toMatchObject({ PGSSLMODE: 'require', PGUSER: 'postgres', PGPASSWORD: 'fixture-password' })
    expect(config.project).toBe('fixtureproject')
  })
  it.each([
    { SUPABASE_URL: 'http://fixtureproject.supabase.co' },
    { SUPABASE_URL: 'https://attacker.example' },
    { SUPABASE_DB_URL: 'postgresql://postgres:fixture@db.different.supabase.co/postgres' },
    { SUPABASE_DB_URL: `${env.SUPABASE_DB_URL}?sslmode=disable` },
    { SUPABASE_DB_URL: `${env.SUPABASE_DB_URL}?options=malicious` },
    { SUPABASE_SERVICE_ROLE_KEY: '' },
  ])('rejects insecure or mismatched configuration', (override) => {
    expect(() => sourceConfig({ ...env, ...override })).toThrow()
  })
  it('preflight never sends a request and reports verification limits accurately', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Network forbidden') })
    try {
      expect(await main(['preflight'], env)).toEqual({ configurationValid: true, networkChecked: false, pgDumpChecked: false, restoreChecked: false })
      expect(network).not.toHaveBeenCalled()
      await expect(main(['create', '--password', 'fixture'], env)).rejects.toThrow('secrets')
      await expect(main(['restore-remote'], env)).rejects.toThrow('Unknown command')
    } finally { network.mockRestore() }
  })
  it('spawns pg_dump without a shell, database URI argument or prompt', async () => {
    const processStub = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
    const spawnCommand = vi.fn(() => {
      queueMicrotask(() => { processStub.stdout.write(sql); processStub.stdout.end(); processStub.emit('close', 0) })
      return processStub
    })
    expect(await dumpPublicDatabase(sourceConfig(env).pgEnv, { spawnCommand })).toEqual(sql)
    const [, argumentsList, options] = spawnCommand.mock.calls[0]
    expect(argumentsList.join(' ')).not.toContain('fixture-password')
    expect(argumentsList).toContain('--no-password')
    expect(argumentsList).toContain('--exclude-table-data=public.sessions')
    expect(argumentsList).toContain('--exclude-table-data=public.application_access_tokens')
    expect(options).toMatchObject({ shell: false, windowsHide: true })
  })
})

it('lists required private buckets recursively and downloads only from the same origin without redirects', async () => {
  const calls = []
  const network = async (url, options) => {
    calls.push([url, options])
    if (url.endsWith('/bucket')) return Response.json(['documents', 'interview-recordings'].map((id) => ({ id, public: false })))
    if (url.includes('/object/list/')) {
      const { prefix } = JSON.parse(options.body)
      if (url.endsWith('/interview-recordings')) return Response.json([])
      if (!prefix) return Response.json([{ name: '지원서', id: null }])
      return Response.json([{ name: 'resume.pdf', id: 'object-1', updated_at: '2026-09-19', metadata: { size: pdf.length, mimetype: 'application/pdf' } }])
    }
    return new Response(pdf)
  }
  const source = storageSource(sourceConfig(env), network)
  const inventory = await source.inventory()
  expect(inventory.objects).toHaveLength(1)
  expect(Buffer.from(await new Response(await source.download(inventory.objects[0])).arrayBuffer())).toEqual(pdf)
  expect(calls.every(([url, options]) => url.startsWith('https://fixtureproject.supabase.co/storage/v1/') && options.redirect === 'error')).toBe(true)
})

it.each([404, 403, 503])('fails closed when storage responds %s', async (status) => {
  const source = storageSource(sourceConfig(env), async () => new Response('fixture diagnostic', { status }))
  await expect(source.inventory()).rejects.toThrow(`Storage request failed (${status})`)
})

it('requires quiescence and aborts changed storage inventories without publishing partial backup', async () => {
  const objects = entries().filter((entry) => entry.kind === 'object').map(({ body: _body, ...description }) => description)
  const initial = { buckets: [], objects }
  const source = { inventory: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, objects: [] }),
    download: vi.fn(async (entry) => entries().find((item) => item.bucket === entry.bucket && item.name === entry.name).body) }
  const output = workspace.unique(), config = sourceConfig(env)
  await expect(acquireBackup({ output, key, config, source, dump: async () => sql })).rejects.toThrow('confirm-quiesced')
  expect(source.inventory).not.toHaveBeenCalled()
  await expect(acquireBackup({ output, key, config, source, dump: async () => sql, quiesced: true })).rejects.toThrow('Storage changed')
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
}, 30000)
