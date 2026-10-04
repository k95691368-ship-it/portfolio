// @vitest-environment node
// 오프라인 복원이 로그인·복구 토큰을 되살리지 않는지. 병렬 실행을 위해 backupRecovery.test.js 에서 나눴다.
import { expect, it } from 'vitest'
import { restoreDatabase } from '../scripts/backup-recovery-lib.mjs'
import { sql } from './helpers/backupFixture.js'

it('preserves account data but never revives existing login/recovery tokens during an offline restore', async () => {
  const tables = ['sessions', 'room_access_sessions', 'account_recovery_tokens', 'application_access_tokens', 'application_access_sessions']
  const credentials = tables.map((table) => `CREATE TABLE public.${table}(token_hash text); INSERT INTO public.${table} VALUES ('fixture-old-token');`).join('\n')
  const restored = await restoreDatabase(Buffer.concat([sql, Buffer.from(`\n${credentials}`)]))
  try {
    for (const table of tables) expect((await restored.pg.query(`SELECT count(*)::int AS count FROM public.${table}`)).rows).toEqual([{ count: 0 }])
    expect((await restored.pg.query('SELECT count(*)::int AS count FROM public.applications')).rows).toEqual([{ count: 1 }])
  } finally { await restored.pg.close() }
}, 30000)
