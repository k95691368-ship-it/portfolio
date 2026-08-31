import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// 첫 화면이 뜨기까지 브라우저가 몇 번 왕복하는가.
//
// 재 보니 두 군데서 기다리고 있었다.
//
//   하나. 스타일시트가 첫 그림을 막는다. 첫 글자가 124ms 에 떴는데 CSS 가
//   100ms 에 도착했다 -- 껍데기를 인라인 스타일로 그려 놔도, <head> 의
//   stylesheet 링크 하나가 그 그림까지 붙잡는다. 브라우저는 스타일이 다 오기
//   전에는 아무것도 그리지 않기 때문이다.
//
//   둘. 화면 조각이 한 박자 늦게 출발한다. /jobs 를 바로 열면 본 코드가 75ms 에
//   도착하고, 그것을 실행해 "아 JobsPage 가 필요하구나"를 안 뒤에야 그 조각을
//   받으러 간다 -- 145ms. 왕복이 하나 더 있는 셈이고, 그 사이 화면은 비어 있다.
//
// 아래 플러그인이 둘 다 없앤다.
//
//   CSS 는 index.html 안에 넣는다. 요청이 하나 줄고, 첫 그림이 스타일을
//   기다리지 않는다. 대신 다시 찾아온 사람이 CSS 를 캐시에서 못 쓰게 되는데,
//   이 사이트는 화면을 옮겨도 문서를 새로 받지 않으므로(SPA) 통째 로드 자체가
//   드물다. 처음 오는 사람 쪽을 택한다.
//
//   화면 조각은 주소를 보고 미리 받는다. 어느 주소에 어느 조각이 필요한지는
//   빌드가 알고 있으므로, 그 표를 HTML 에 적어 두고 문서를 읽는 순간 함께
//   출발시킨다.

// 주소 -> 그 화면을 그리는 파일. 아래에서 빌드 결과와 맞춰 실제 조각 이름을 찾는다.
const ROUTE_PAGES = [
  ['/jobs', 'JobsPage.jsx'],
  ['/application-status', 'ApplicationStatusPage.jsx'],
  ['/verify', 'VerifyCertificatePage.jsx'],
  ['/tech', 'TechPage.jsx'],
  ['/dashboard', 'DashboardPage.jsx'],
  ['/recruit', 'RecruitPage.jsx'],
  ['/admin', 'AdminPage.jsx'],
  ['/signup', 'SignupPage.jsx'],
  ['/change-password', 'ChangePasswordPage.jsx'],
  // 아래 셋은 주소에 id 가 붙는다. 앞부분만 맞으면 된다.
  ['/rooms/', 'RoomPage.jsx'],
  ['/rooms/:contract', 'ContractPage.jsx'],
  ['/jobs/:apply', 'ApplyPage.jsx'],
  ['/jobs/:detail', 'JobDetailPage.jsx'],
]

// CSS 를 문서 안에 넣는 것이 실제로 이득인지 둘로 갈라 재 봤다. 나머지 조건을
// 똑같이 두고 이것만 켜고 끈 결과(각 5회 중앙값):
//
//              문서 안에    파일로 따로
//   첫 화면      104ms       124ms
//   공고 목록     80ms       104ms
//   기술 설명     84ms       108ms
//
// 세 화면 모두 20~24ms 빨라진다. 방향이 일정하고 이유도 분명하다 -- 막고 있던
// 왕복이 하나 사라진다.
const INLINE_CSS = true

function fastFirstPaint() {
  return {
    name: 'fast-first-paint',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find(
        (f) => f.type === 'asset' && f.fileName.endsWith('index.html')
      )
      if (!html) return
      let source = String(html.source)

      // 1) 스타일시트를 문서 안으로 옮긴다.
      const cssFiles = INLINE_CSS
        ? Object.values(bundle).filter((f) => f.type === 'asset' && f.fileName.endsWith('.css'))
        : []
      for (const css of cssFiles) {
        const link = new RegExp(
          `<link[^>]+href="/${css.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`,
          'g'
        )
        if (!link.test(source)) continue
        source = source.replace(link, `<style>${String(css.source)}</style>`)
        // 문서 안에 들어갔으므로 따로 내보내지 않는다.
        delete bundle[css.fileName]
      }

      // 2) 주소마다 필요한 조각을 미리 받게 한다.
      //
      // 조각 하나를 받으려면 그것이 기대는 조각들도 함께 있어야 하므로,
      // 딸린 것까지 따라 들어가 모은다.
      const byFacade = new Map()
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk' && file.facadeModuleId) {
          byFacade.set(file.facadeModuleId.replace(/\\/g, '/'), file)
        }
      }
      const withDeps = (chunk, seen = new Set()) => {
        if (!chunk || seen.has(chunk.fileName)) return seen
        seen.add(chunk.fileName)
        for (const dep of chunk.imports || []) withDeps(bundle[dep], seen)
        return seen
      }

      const map = {}
      for (const [route, page] of ROUTE_PAGES) {
        const entry = [...byFacade.entries()].find(([id]) => id.endsWith(`/pages/${page}`))
        if (!entry) continue
        // 본 묶음이 이미 받는 것은 뺀다 -- 두 번 받을 이유가 없다.
        const main = Object.values(bundle).find(
          (f) => f.type === 'chunk' && f.isEntry
        )
        const already = withDeps(main)
        map[route] = [...withDeps(entry[1])].filter((f) => !already.has(f))
      }

      const loader = `<script>
(function () {
  var M = ${JSON.stringify(map)}
  var p = location.pathname
  var files =
    p.indexOf('/rooms/') === 0
      ? (p.slice(-9) === '/contract' ? M['/rooms/:contract'] : M['/rooms/'])
      : p.indexOf('/jobs/') === 0
        ? (p.slice(-6) === '/apply' ? M['/jobs/:apply'] : M['/jobs/:detail'])
        : M[p]
  if (!files) return
  for (var i = 0; i < files.length; i++) {
    var l = document.createElement('link')
    l.rel = 'modulepreload'
    l.href = '/' + files[i]
    document.head.appendChild(l)
  }
})()
</script>`
      source = source.replace('</head>', `${loader}\n  </head>`)
      html.source = source
    },
  }
}

// 브라우저에게 "이 사이트에서는 이것만 허용한다"를 알려 준다.
//
// 지금은 아무 제한이 없다. 어떤 경로로든 스크립트가 한 줄 끼어들면 그것이
// 그대로 돈다 -- 이 화면에는 지원자 개인정보와 근로계약 조건이 떠 있고,
// 서명 버튼이 있다.
//
// 문제는 이 사이트가 인라인 스크립트를 쓴다는 것이다(화면 색 먼저 입히기,
// 분석 도구 큐, 조각 미리 받기). 'unsafe-inline' 으로 열면 CSP 를 붙이나 마나다.
// 그래서 빌드가 그 스크립트들의 해시를 계산해 그것만 허용한다 -- 한 글자라도
// 바뀌면 해시가 달라져 자동으로 갱신되고, 끼어든 스크립트는 해시가 없어 막힌다.
//
// frame-ancestors 도 여기서 막는다. 계약서 화면을 보이지 않는 액자에 넣고 그
// 위에 가짜 버튼을 얹으면, 누르는 사람은 다른 것을 누른 줄 알고 서명한다.
const ANALYTICS = {
  script: ['https://www.googletagmanager.com', 'https://www.clarity.ms', 'https://scripts.clarity.ms'],
  connect: [
    'https://www.google-analytics.com',
    'https://analytics.google.com',
    'https://*.google-analytics.com',
    'https://*.clarity.ms',
    'https://*.googletagmanager.com',
  ],
  img: ['https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.clarity.ms'],
}

// 일부러 허용하지 않는 것: c.bing.com
//
// 클래리티가 켜지면 마이크로소프트의 광고 동기화 픽셀을 하나 더 부른다. 화면을
// 어떻게 쓰는지 보려고 붙인 도구인데, 그 김에 방문자를 광고 쪽 식별자와 묶는
// 일까지 한다. 이 사이트에는 지원자와 근로계약이 있다 -- 그 사람이 여기 왔다는
// 사실을 광고 판에 넘길 이유가 없다.
//
// 막아도 클래리티의 녹화와 히트맵은 그대로 돈다. 콘솔에 차단 기록이 한 줄
// 남는데, 그것은 고장이 아니라 이 정책이 일하고 있다는 표시다.

function securityHeaders() {
  return {
    name: 'security-headers',
    apply: 'build',
    enforce: 'post',
    writeBundle(options) {
      const dir = options.dir || 'dist'
      const htmlPath = join(dir, 'index.html')
      if (!existsSync(htmlPath)) return
      const html = readFileSync(htmlPath, 'utf-8')

      // 인라인 스크립트의 해시. CSP 는 여는 태그와 닫는 태그 사이의 내용을
      // 그대로(공백까지) 해시한다.
      //
      // 줄바꿈을 먼저 맞춘다. 이 저장소는 윈도우에서 쓰여 index.html 이
      // CRLF 인데, HTML 파서는 읽으면서 그것을 LF 로 바꾼다. 그래서 파일
      // 그대로 해시하면 브라우저가 계산하는 값과 달라지고, 내가 쓴 스크립트가
      // 내가 건 CSP 에 막힌다 -- 실제로 그렇게 분석 도구가 통째로 죽었다.
      //
      // 빌드가 만들어 넣은 스크립트(LF)만 통과하고 손으로 쓴 넷이 전부 막혀
      // 있었던 것이 단서였다.
      const hashes = []
      for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
        const body = m[1].replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        const h = createHash('sha256').update(body, 'utf-8').digest('base64')
        hashes.push(`'sha256-${h}'`)
      }

      const csp = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(' ')} ${ANALYTICS.script.join(' ')}`,
        // 스타일은 해시로 묶지 않는다. 리액트가 style 속성을 직접 붙이는 곳이
        // 있어 막으면 화면이 깨지고, 스타일 주입은 스크립트 주입만큼 위험하지 않다.
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: ${ANALYTICS.img.join(' ')}`,
        "font-src 'self' data:",
        `connect-src 'self' ${ANALYTICS.connect.join(' ')}`,
        // 서비스워커는 우리 것만.
        "worker-src 'self'",
        // 액자에 넣지 못하게. 클릭재킹을 막는 자리다.
        "frame-ancestors 'none'",
        "frame-src 'none'",
        // <base> 를 바꿔치기해 모든 상대 경로를 남의 서버로 돌리는 것을 막는다.
        "base-uri 'self'",
        // 폼이 남의 서버로 제출되지 못하게. 여기에는 개인정보가 실린다.
        "form-action 'self'",
        "object-src 'none'",
        'upgrade-insecure-requests',
      ].join('; ')

      const headersPath = join(dir, '_headers')
      const extra = [
        '',
        '# 아래는 빌드가 만든다(vite.config.js). 인라인 스크립트 해시가 들어가므로',
        '# 손으로 고치면 다음 빌드에 덮어써진다.',
        '/*',
        `  Content-Security-Policy: ${csp}`,
        // http 로 한 번이라도 가면 중간에서 가로챌 수 있다. 2년간 https 만 쓰게 한다.
        '  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
        '  X-Content-Type-Options: nosniff',
        // CSP 를 못 읽는 낡은 브라우저를 위한 같은 뜻의 옛 헤더.
        '  X-Frame-Options: DENY',
        '  Referrer-Policy: strict-origin-when-cross-origin',
        // 쓰지 않는 기능은 닫는다. 스크립트가 끼어들어도 카메라를 켤 수 없다.
        '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), interest-cohort=()',
        // 우리 자산을 남의 사이트가 가져다 쓰지 못하게 한다. 재 보니 공짜다.
        '  Cross-Origin-Resource-Policy: same-origin',
        //
        // Cross-Origin-Opener-Policy 는 일부러 붙이지 않는다.
        //
        // 붙여 보고 쟀더니 첫 그림이 84ms 에서 172ms 로 늘었다. 두 배다.
        // same-origin 도, 더 느슨한 same-origin-allow-popups 도 똑같이 비쌌다
        // (+60ms, +88ms). 브라우저가 탐색할 때마다 렌더러를 갈아 끼우기 때문이다.
        //
        // 그 값을 치르고 얻는 것은 '이 문서를 연 창이 우리를 조종하지 못하게'다.
        // 그런데 이 사이트는 팝업을 열지도, 팝업으로 열리지도 않는다. 막으려는
        // 일이 애초에 일어나지 않는 자리에 방문자 전원의 첫 화면을 두 배로
        // 늦추는 값을 치를 이유가 없다.
        //
        // 나중에 팝업으로 무언가를 열게 되면 그때 다시 재 보고 판단한다.
        // 재지 않고 "보안에 좋으니까" 다시 붙이지는 말 것.
        // Pages 기본값이 화면 문서까지 아무나 읽어 가게 열어 둔다. 지운다.
        '  ! Access-Control-Allow-Origin',
        '',
      ].join('\n')

      if (existsSync(headersPath)) appendFileSync(headersPath, extra, 'utf-8')
      else writeFileSync(headersPath, extra.trimStart(), 'utf-8')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), fastFirstPaint(), securityHeaders()],
})
