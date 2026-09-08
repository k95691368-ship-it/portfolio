import { describe, expect, it } from 'vitest'
import { postgresQuery } from '../supabase/functions/api/sqlCompat.js'

describe('Supabase PostgreSQL query compatibility', () => {
  it('converts the SQLite Korea-calendar date expression', () => {
    expect(
      postgresQuery("SELECT deadline < date('now', '+9 hours') AS expired")
    ).toBe(
      "SELECT deadline < to_char(timezone('utc', now()) + interval '9 hours', 'YYYY-MM-DD') AS expired"
    )
  })

  it('keeps placeholder conversion after date normalization', () => {
    expect(
      postgresQuery("SELECT * FROM job_postings WHERE id = ? AND deadline >= date('now', '+9 hours')")
    ).toBe(
      "SELECT * FROM job_postings WHERE id = $1 AND deadline >= to_char(timezone('utc', now()) + interval '9 hours', 'YYYY-MM-DD')"
    )
  })
})
