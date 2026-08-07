// AI 호출이 실패했을 때 사용자에게 무엇을 보여 주는가.
//
// 크레딧이 떨어지자 화면에 상위 API 의 원본 JSON 이 그대로 떴다. 영어이고,
// 사용자가 할 수 있는 일은 적혀 있지 않으며, 운영자의 결제 상태를 지나가는
// 사람 모두에게 알린다.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { analyzeConversation } from '../functions/_lib/claude.js'

const ENV = { CLAUDE_API_KEY: 'test-key' }
const TRANSCRIPT = '회사: 안녕하세요\n지원자: 안녕하세요'

function respondWith(status, body) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: async () => body,
    })
  )
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AI 호출 실패 메시지', () => {
  const creditBody =
    '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'

  it('결제 상태를 사용자에게 알리지 않는다', async () => {
    respondWith(400, creditBody)
    await expect(analyzeConversation(ENV, TRANSCRIPT, null)).rejects.toThrow(/일시적으로 중단/)
    await expect(analyzeConversation(ENV, TRANSCRIPT, null)).rejects.not.toThrow(/credit|balance|Billing/i)
  })

  it('상위 API 의 원본 본문을 화면 메시지에 넣지 않는다', async () => {
    respondWith(400, creditBody)
    const err = await analyzeConversation(ENV, TRANSCRIPT, null).catch((e) => e)
    expect(err.message).not.toContain('{')
    expect(err.message).not.toContain('invalid_request_error')
  })

  it('원문은 서버 로그에 남긴다 — 원인을 볼 수 있어야 고친다', async () => {
    respondWith(400, creditBody)
    await analyzeConversation(ENV, TRANSCRIPT, null).catch(() => {})
    expect(console.error).toHaveBeenCalled()
    expect(String(console.error.mock.calls[0][1])).toContain('credit balance')
  })

  it('상태 코드마다 무엇을 할 수 있는지 다르게 말한다', async () => {
    respondWith(429, 'rate limited')
    await expect(analyzeConversation(ENV, TRANSCRIPT, null)).rejects.toThrow(/잠시 후 다시 시도/)

    respondWith(503, 'upstream down')
    await expect(analyzeConversation(ENV, TRANSCRIPT, null)).rejects.toThrow(/응답하지 않습니다/)

    respondWith(401, 'bad key')
    await expect(analyzeConversation(ENV, TRANSCRIPT, null)).rejects.toThrow(/인증 설정/)
  })

  it('AI 가 멈춰도 쓸 수 있는 것이 있다고 알려 준다', async () => {
    respondWith(400, creditBody)
    const err = await analyzeConversation(ENV, TRANSCRIPT, null).catch((e) => e)
    expect(err.message).toMatch(/법령 점검|서명/)
  })
})
