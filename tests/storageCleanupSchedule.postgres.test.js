// @vitest-environment node
import { afterAll, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync('supabase/migrations/202610040001_storage_cleanup_schedule.sql', 'utf8')
let pg
afterAll(async () => { await pg?.close() })

it('is opt-in, survives missing local extensions, and schedules only the independent receipt job', async () => {
  pg = new PGlite()
  await pg.exec(sql)
  expect((await pg.query("SELECT to_regnamespace('cron') AS cron,to_regnamespace('net') AS net,to_regclass('vault.decrypted_secrets') AS vault")).rows[0])
    .toEqual({ cron: null, net: null, vault: null })

  // These are isolated test doubles, not extensions, network calls or secrets.
  await pg.exec(`CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA vault;
    CREATE TABLE cron.fixture_jobs(name TEXT PRIMARY KEY,schedule TEXT,command TEXT);
    CREATE FUNCTION cron.schedule(job_name TEXT,job_schedule TEXT,job_command TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO cron.fixture_jobs VALUES(job_name,job_schedule,job_command)
        ON CONFLICT(name) DO UPDATE SET schedule=excluded.schedule,command=excluded.command; RETURN 1; END $$;
    CREATE TABLE vault.decrypted_secrets(name TEXT PRIMARY KEY,decrypted_secret TEXT);
    INSERT INTO vault.decrypted_secrets VALUES('storage_cleanup_job_secret','fixture-only-job-secret');`)
  await pg.exec(sql)
  expect((await pg.query('SELECT * FROM cron.fixture_jobs')).rows).toEqual([])
  await pg.exec('CREATE TABLE public.storage_cleanup_intents(fixture TEXT); DELETE FROM vault.decrypted_secrets;')
  await pg.exec(sql)
  expect((await pg.query('SELECT * FROM cron.fixture_jobs')).rows).toEqual([])
  await pg.exec("INSERT INTO vault.decrypted_secrets VALUES('retention_job_secret','fixture-unrelated')")
  await pg.exec(sql)
  expect((await pg.query('SELECT * FROM cron.fixture_jobs')).rows).toEqual([])

  await pg.exec("INSERT INTO vault.decrypted_secrets VALUES('storage_cleanup_job_secret','fixture-only-job-secret')")
  await pg.exec(sql)
  await pg.exec(sql)
  const { rows } = await pg.query('SELECT * FROM cron.fixture_jobs')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ name: 'portfolio-storage-cleanup-hourly', schedule: '23 * * * *' })
  expect(rows[0].command).toContain('https://obumqkwkvnemkyaahjbn.supabase.co/functions/v1/storage-cleanup')
  expect(rows[0].command).toContain("name = 'storage_cleanup_job_secret'")
  expect(rows[0].command).toContain('"dryRun": false')
  expect(rows[0].command).not.toContain('/functions/v1/retention')
  expect(rows[0].command).not.toContain('fixture-only-job-secret')
}, 30000)
