import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 서버 코드를 한 번은 돌려 본다.
//
// 이 저장소의 시험 689건은 전부 순수 함수만 본다. 법령 계산, 기간 판정,
// 공고 대조 같은 것들이다. 그 계산이 옳은지는 촘촘히 보면서, 정작 **그
// 계산을 부르는 라우트가 실행되는지는 한 번도 안 봤다.**
//
// 실행해야만 드러나는 종류가 있다. 선언 전에 쓴 변수, 없는 함수 호출,
// undefined 를 파고드는 구조분해. 이것들은 문법이 맞아서 린트도 빌드도
// 통과하고, 순수 함수 시험도 그 파일을 안 건드리니 전부 초록불이다.
// 그러다 배포된 화면에서 500 이 뜬다.
//
// 그래서 여기서 돌린다. D1 과 R2 를 흉내 낸 껍데기를 주고 GET 핸들러를
// 하나씩 부른다. 데이터가 없으니 대부분 "없습니다"를 돌려줄 텐데 그건
// 상관없다. 잡으려는 것은 답의 내용이 아니라 **실행하다 터지는 것**이다.

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 실행해 봐야만 나오는 오류들. 이 문구가 응답에 섞여 있으면 터진 것이다.
const RUNTIME_ERROR = [
  'before initialization',
  'is not a function',
  'is not defined',
  'Cannot read properties',
  'Cannot convert undefined',
  'undefined is not',
  'null is not',
  'Assignment to constant',
]

// 어느 칸을 물어도 그럴듯한 값을 내주는 줄.
//
// 빈 데이터베이스만 주면 대부분의 라우트가 "그런 것이 없습니다"로 일찍
// 되돌아간다. 그러면 정작 일하는 코드는 한 줄도 안 밟힌다.
const ANY_ROW = new Proxy(
  {},
  {
    get(_, k) {
      if (typeof k !== 'string') return undefined
      // await 가 이 객체를 thenable 로 오해하면 영원히 안 끝난다.
      if (k === 'then' || k === 'toJSON') return undefined
      if (k === 'results') return []
      if (/_at$|^created|^updated|^signed|^issued|^expires/.test(k)) return '2026-08-01 00:00:00'
      if (/^n$|count|amount|wage|hours|days|minutes|seconds|months|years|size|total|seq|ord/i.test(k)) return 1
      if (k === 'id' || k.endsWith('_id')) return 'x1'
      if (k === 'status') return 'active'
      if (k === 'role_in_room') return 'company'
      if (k === 'email') return 'a@b.test'
      // 헤더에 그대로 들어가는 칸들. 한글을 주면 코드가 아니라 이 껍데기
      // 때문에 터진다 -- HTTP 헤더는 아스키만 담는다.
      if (k === 'content_type') return 'application/pdf'
      if (/key$|^r2_|path/.test(k)) return 'k/1'
      return '값'
    },
    has: () => true,
  }
)

function fakeDB(withRows) {
  // 세는 질의는 빈 표에서도 반드시 한 줄을 돌려준다.
  //
  // 처음에는 빈 표면 무조건 null 을 줬는데, 그것이 사실과 달랐다. D1 에서
  // SELECT COUNT(*) 는 셀 것이 없어도 { count: 0 } 을 준다. null 을 주면
  // 멀쩡한 코드가 터진 것처럼 보이고, 그런 검사는 몇 번 울부짖고 나면
  // 아무도 안 믿는다.
  const isAggregate = (sql) => /(count|sum|avg|min|max)\s*\(/i.test(String(sql ?? ''))

  const make = (sql) => {
    const stmt = {
      bind: () => stmt,
      first: async () => {
        if (withRows) return ANY_ROW
        return isAggregate(sql) ? ZERO_ROW : null
      },
      all: async () => ({ results: withRows ? [ANY_ROW] : [] }),
      run: async () => ({ meta: {} }),
    }
    return stmt
  }

  return {
    prepare: (sql) => make(sql),
    batch: async (list) => (list ?? []).map(() => ({ meta: {} })),
    exec: async () => ({}),
  }
}

// 세어 봤더니 0 이더라, 를 흉내 낸 줄.
const ZERO_ROW = new Proxy(
  {},
  {
    get(_, k) {
      if (typeof k !== 'string') return undefined
      if (k === 'then' || k === 'toJSON') return undefined
      return 0
    },
    has: () => true,
  }
)

// R2. 계약서 파일 보관함이다. 이게 없으면 내려받기 라우트가 껍데기 탓에
// 터지는데, 그건 코드가 틀린 것이 아니다.
function fakeR2() {
  const object = { body: null, arrayBuffer: async () => new ArrayBuffer(0), httpMetadata: {}, size: 0 }
  return {
    get: async () => object,
    head: async () => object,
    list: async () => ({ objects: [], truncated: false }),
    put: async () => ({}),
    delete: async () => ({}),
  }
}

// 로그인한 사람. 미들웨어가 넣어 주는 값이라 여기서 흉내 낸다.
// 관리자로 한 번, 일반 회사 계정으로 한 번 돌려 양쪽 분기를 다 밟는다.
function fakeUser(isAdmin) {
  return {
    id: 'u1',
    email: 'a@b.test',
    display_name: '홍길동',
    company_name: '가상상사',
    role: 'company',
    is_admin: isAdmin ? 1 : 0,
    is_recruiter: 1,
    is_developer: 0,
  }
}

function fakeEnv(withRows) {
  return {
    DB: fakeDB(withRows),
    DOCUMENTS: fakeR2(),
    // 키는 주지 않는다. AI 를 실제로 부르면 안 되고, 키가 없을 때
    // 얌전히 되돌아가는지도 함께 보게 된다.
    EMAIL_ENABLED: '0',
  }
}

function apiFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) apiFiles(p, out)
    else if (name.endsWith('.js') && !name.startsWith('_')) out.push(p)
  }
  return out
}

describe('서버 라우트를 한 번씩 돌려 본다', () => {
  const files = apiFiles(join(ROOT, 'functions', 'api'))

  it('라우트를 찾아 낸다', () => {
    // 이 시험이 헛돌지 않는지 먼저 본다. 경로가 어긋나 파일을 하나도 못
    // 읽으면 아래는 전부 통과하지만 아무것도 안 본 것이 된다.
    expect(files.length).toBeGreaterThan(40)
  })

  it('GET 라우트가 빈 표에서도, 줄이 있을 때도 터지지 않는다', async () => {
    const problems = []

    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join('/')
      let mod
      try {
        mod = await import(pathToFileURL(file).href)
      } catch (err) {
        problems.push(`${rel} — 파일을 읽지도 못했습니다: ${err.message}`)
        continue
      }
      if (typeof mod.onRequestGet !== 'function') continue

      for (const [label, withRows, isAdmin] of [
        ['빈 표', false, false],
        ['줄이 있을 때', true, false],
        ['관리자', true, true],
      ]) {
        const ctx = {
          env: fakeEnv(withRows),
          data: { user: fakeUser(isAdmin) },
          params: { id: 'x1', roomId: 'r1', reqId: 'q1', docId: 'd1', path: 'a/b' },
          request: new Request('https://example.test/api/x'),
          waitUntil: () => {},
        }

        let res
        try {
          res = await mod.onRequestGet(ctx)
        } catch (err) {
          problems.push(`${rel} (${label}) — 예외가 새어 나왔습니다: ${err.message}`)
          continue
        }

        if (!(res instanceof Response)) {
          problems.push(`${rel} (${label}) — Response 를 안 돌려줬습니다`)
          continue
        }

        const body = await res.text()
        const hit = RUNTIME_ERROR.find((sig) => body.includes(sig))
        if (hit) problems.push(`${rel} (${label}) — 실행하다 터졌습니다: ${body.slice(0, 160)}`)
      }
    }

    expect(problems).toEqual([])
  }, 60000)
})
