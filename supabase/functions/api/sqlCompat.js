export function postgresPlaceholders(source) {
  let output = ''
  let nextIndex = 1
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === "'") {
      output += character
      if (quoted && source[index + 1] === "'") {
        output += source[index + 1]
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (character !== '?' || quoted) {
      output += character
      continue
    }

    const numbered = source.slice(index + 1).match(/^\d+/)?.[0]
    const parameterIndex = numbered ? Number(numbered) : nextIndex
    output += `$${parameterIndex}`
    if (numbered) {
      index += numbered.length
      nextIndex = Math.max(nextIndex, parameterIndex + 1)
    } else {
      nextIndex += 1
    }
  }

  return output
}

function addConflictFallback(query) {
  if (/\bON\s+CONFLICT\b/i.test(query)) return query
  const returning = query.search(/\bRETURNING\b/i)
  if (returning === -1) return `${query.trimEnd()} ON CONFLICT DO NOTHING`
  return `${query.slice(0, returning).trimEnd()} ON CONFLICT DO NOTHING ${query.slice(returning)}`
}

export function postgresQuery(source) {
  let query = String(source ?? '').trim()
  const ignoredInsert = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(query)
  query = query.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO')
  // SQLite's date(value, modifier) has no two-argument PostgreSQL equivalent.
  // The application only uses this expression for the Korea-calendar deadline,
  // so normalize it before sending the statement to Postgres.
  query = query.replace(
    /date\(\s*'now'\s*,\s*'\+9 hours'\s*\)/gi,
    "to_char(timezone('utc', now()) + interval '9 hours', 'YYYY-MM-DD')"
  )
  query = postgresPlaceholders(query)
  if (ignoredInsert) query = addConflictFallback(query)
  if (/^INSERT\s+INTO\s+rate_limit_hits\b/i.test(query) && !/\bRETURNING\b/i.test(query)) {
    query = `${query} RETURNING id`
  }
  return query
}

export function normalizePostgresError(error) {
  if (!error || typeof error !== 'object') return error
  if (error.code === '23505' && !String(error.message).includes('UNIQUE')) {
    error.message = `UNIQUE constraint failed: ${error.message}`
  }
  if (error.code === '23503' && !String(error.message).includes('FOREIGN KEY')) {
    error.message = `FOREIGN KEY constraint failed: ${error.message}`
  }
  return error
}
