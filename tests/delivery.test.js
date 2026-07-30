import { describe, it, expect } from 'vitest'
import { describeDeliveryState, channelLabel, DELIVERY_CHANNELS } from '../functions/_lib/delivery.js'

describe('channelLabel', () => {
  it('채널을 한국어로 옮긴다', () => {
    expect(channelLabel('in_app')).toBe('앱에서 열람 가능')
    expect(channelLabel('email')).toBe('이메일 발송')
    expect(channelLabel('download')).toBe('근로자 직접 내려받기')
    expect(channelLabel('paper')).toBe('인쇄 교부')
  })
  it('알 수 없는 채널은 그대로 둔다', () => {
    expect(channelLabel('fax')).toBe('fax')
  })
  it('채널 목록이 네 가지다', () => {
    expect(DELIVERY_CHANNELS).toEqual(['in_app', 'email', 'download', 'paper'])
  })
})

describe('describeDeliveryState', () => {
  it('아무 기록이 없으면 교부 미완료', () => {
    const s = describeDeliveryState([])
    expect(s.delivered).toBe(false)
    expect(s.viewed).toBe(false)
    expect(s.label).toBe('교부 미완료')
    expect(s.detail).toContain('제17조 제2항')
  })

  it('값이 없어도 무너지지 않는다', () => {
    expect(describeDeliveryState(null).delivered).toBe(false)
  })

  it('앱에서 열람 가능해진 것만으로 교부로 본다', () => {
    const s = describeDeliveryState([{ channel: 'in_app', status: 'delivered' }])
    expect(s.delivered).toBe(true)
    expect(s.viewed).toBe(false)
    expect(s.label).toContain('확인 대기')
  })

  it('근로자가 열람하면 교부 완료로 본다', () => {
    const s = describeDeliveryState([
      { channel: 'in_app', status: 'delivered', firstViewedAt: '2026-09-01 10:00:00' },
    ])
    expect(s.viewed).toBe(true)
    expect(s.label).toContain('근로자 확인')
  })

  it('내려받은 것도 확인으로 본다', () => {
    const s = describeDeliveryState([
      { channel: 'download', status: 'delivered', downloadedAt: '2026-09-01 10:00:00' },
    ])
    expect(s.viewed).toBe(true)
  })

  it('이메일이 실패한 것만 있으면 교부로 보지 않는다', () => {
    const s = describeDeliveryState([{ channel: 'email', status: 'failed' }])
    expect(s.delivered).toBe(false)
    expect(s.emailFailed).toBe(true)
  })

  it('이메일이 실패했어도 앱 열람이 가능하면 교부로 본다', () => {
    const s = describeDeliveryState([
      { channel: 'email', status: 'failed' },
      { channel: 'in_app', status: 'delivered' },
    ])
    expect(s.delivered).toBe(true)
    expect(s.emailFailed).toBe(true)
  })

  it('인쇄 교부도 교부 수단이다', () => {
    expect(describeDeliveryState([{ channel: 'paper', status: 'delivered' }]).delivered).toBe(true)
  })
})
