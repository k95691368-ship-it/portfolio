import { afterEach, beforeEach, expect, it } from 'vitest'
import { sqliteApp } from './helpers/sqliteApp.js'

let db
beforeEach(() => {
  db = sqliteApp()
  db.sql.exec('CREATE TABLE returning_fixture (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
})
afterEach(() => db.close())

it('run exposes RETURNING rows and changes while executing the mutation once', async () => {
  const result = await db.prepare('INSERT INTO returning_fixture (id,payload) VALUES (?,?) RETURNING id,payload')
    .bind('original', 'first').run()
  expect(result.results).toEqual([{ id: 'original', payload: 'first' }])
  expect(result.meta.changes).toBe(1)
  expect(db.sql.prepare('SELECT count(*) n FROM returning_fixture').get().n).toBe(1)
})

it('batch returns the atomic UPSERT ID and preserves per-statement mutation metadata', async () => {
  await db.prepare('INSERT INTO returning_fixture (id,payload) VALUES (?,?)').bind('original', 'first').run()
  const result = await db.batch([
    db.prepare('UPDATE returning_fixture SET payload=payload WHERE id=?').bind('original'),
    db.prepare(`INSERT INTO returning_fixture (id,payload) VALUES (?,?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload RETURNING id,payload`).bind('original', 'second'),
  ])
  expect(result[0].meta.changes).toBe(1)
  expect(result[1].meta.changes).toBe(1)
  expect(result[1].results).toEqual([{ id: 'original', payload: 'second' }])
  expect(db.sql.prepare('SELECT count(*) n FROM returning_fixture').get().n).toBe(1)
})

it('rolls a mutation with RETURNING back when a later batch statement fails', async () => {
  await expect(db.batch([
    db.prepare('INSERT INTO returning_fixture (id,payload) VALUES (?,?) RETURNING id').bind('rollback', 'first'),
    db.prepare('INSERT INTO returning_fixture (id,payload) VALUES (?,?)').bind('rejected', null),
  ])).rejects.toThrow()
  expect(db.sql.prepare('SELECT count(*) n FROM returning_fixture').get().n).toBe(0)
})
