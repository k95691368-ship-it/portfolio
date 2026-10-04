// @vitest-environment node
// 수집부터 오프라인 검증까지 전체 경로. 병렬 실행을 위해 backupRecovery.test.js 에서 나눴다.
import { expect, it } from 'vitest'
import { verifyBackup, sourceConfig, acquireBackup } from '../scripts/backup-recovery-lib.mjs'
import { key, sql, entries, env, backupWorkspace } from './helpers/backupFixture.js'

const workspace = backupWorkspace()

it('runs the complete mocked-source acquisition and real offline SQL/files verification path', async () => {
  const objects = entries().filter((entry) => entry.kind === 'object').map(({ body: _body, ...description }) => description)
  const source = { inventory: async () => ({ buckets: [], objects }),
    download: async (entry) => entries().find((item) => item.bucket === entry.bucket && item.name === entry.name).body }
  const output = workspace.unique()
  expect(await acquireBackup({ output, key, config: sourceConfig(env), source, dump: async () => sql, quiesced: true })).toMatchObject({ objects: 3 })
  expect(await verifyBackup({ input: output, key })).toMatchObject({ tables: 2, objects: 3, rows: '2' })
}, 30000)
