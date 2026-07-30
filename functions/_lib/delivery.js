import { genId } from './db.js'

// 근로계약서 교부 기록.
//
// 근로기준법 제17조 제2항의 교부 의무가 회사의 수동 클릭에 달려 있었고, 받은
// 기록도 남지 않았다. 체결이 끝나는 순간 서버가 스스로 교부 상태를 만들고,
// 근로자가 실제로 열어 보거나 내려받은 시각을 남긴다.

export const DELIVERY_CHANNELS = ['in_app', 'email', 'download', 'paper']

const CHANNEL_LABELS = {
  in_app: '앱에서 열람 가능',
  email: '이메일 발송',
  download: '근로자 직접 내려받기',
  paper: '인쇄 교부',
}

export function channelLabel(channel) {
  return CHANNEL_LABELS[channel] || channel
}

// 교부 행을 만든다. 같은 채널이 이미 있으면 시각만 새로 한다.
export async function recordDelivery(
  env,
  roomId,
  { channel, recipientUserId, recipientAddress, status = 'delivered', errorMessage = null }
) {
  await env.DB.prepare(
    `INSERT INTO contract_deliveries
       (id, room_id, recipient_user_id, channel, recipient_address, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id, channel) DO UPDATE SET
       recipient_user_id = excluded.recipient_user_id,
       recipient_address = excluded.recipient_address,
       status = excluded.status,
       error_message = excluded.error_message,
       attempt_count = contract_deliveries.attempt_count + 1,
       delivered_at = datetime('now')`
  )
    .bind(genId(), roomId, recipientUserId ?? null, channel, recipientAddress ?? null, status, errorMessage)
    .run()
}

// 근로자가 계약서를 처음 열어 본 시각. 이미 있으면 덮어쓰지 않는다.
export async function markFirstViewed(env, roomId) {
  await env.DB.prepare(
    `UPDATE contract_deliveries SET first_viewed_at = datetime('now')
      WHERE room_id = ? AND channel = 'in_app' AND first_viewed_at IS NULL`
  )
    .bind(roomId)
    .run()
    .catch(() => {})
}

// 근로자가 파일을 내려받은 시각.
export async function markDownloaded(env, roomId, recipientUserId) {
  await env.DB.prepare(
    `INSERT INTO contract_deliveries (id, room_id, recipient_user_id, channel, downloaded_at)
     VALUES (?, ?, ?, 'download', datetime('now'))
     ON CONFLICT(room_id, channel) DO UPDATE SET
       downloaded_at = COALESCE(contract_deliveries.downloaded_at, datetime('now')),
       attempt_count = contract_deliveries.attempt_count + 1`
  )
    .bind(genId(), roomId, recipientUserId ?? null)
    .run()
    .catch(() => {})
}

export async function listDeliveries(env, roomId) {
  const { results } = await env.DB.prepare(
    `SELECT channel, status, recipient_address, attempt_count, delivered_at,
            first_viewed_at, downloaded_at, error_message
       FROM contract_deliveries WHERE room_id = ? ORDER BY delivered_at ASC`
  )
    .bind(roomId)
    .all()

  return results.map((r) => ({
    channel: r.channel,
    channelLabel: channelLabel(r.channel),
    status: r.status,
    recipientAddress: r.recipient_address,
    attemptCount: r.attempt_count,
    deliveredAt: r.delivered_at,
    firstViewedAt: r.first_viewed_at,
    downloadedAt: r.downloaded_at,
    errorMessage: r.error_message,
  }))
}

// 교부가 이루어졌다고 볼 수 있는가 (순수 함수 — 단위 테스트 대상).
//
// 이메일이 실패한 채로 남아 있으면 교부로 보지 않는다. 근로자가 앱에서 열람할
// 수 있게 된 것(in_app)은 그 자체로 교부 수단이며, 실제로 열어 봤거나
// 내려받았다면 더 분명하다.
export function describeDeliveryState(deliveries) {
  const list = deliveries || []
  const ok = (channel) => list.some((d) => d.channel === channel && d.status === 'delivered')

  const viewed = list.some((d) => d.firstViewedAt || d.downloadedAt)
  const delivered = ok('in_app') || ok('email') || ok('download') || ok('paper')
  const emailFailed = list.some((d) => d.channel === 'email' && d.status === 'failed')

  let label
  if (viewed) label = '교부 완료 (근로자 확인)'
  else if (delivered) label = '교부됨 (근로자 확인 대기)'
  else label = '교부 미완료'

  return {
    delivered,
    viewed,
    emailFailed,
    label,
    detail: viewed
      ? '근로자가 계약서를 열람했습니다.'
      : delivered
        ? '근로자가 계약서를 열람할 수 있는 상태입니다. 아직 확인하지 않았습니다.'
        : '아직 근로자에게 계약서가 전달되지 않았습니다. 근로기준법 제17조 제2항에 따라 교부해야 합니다.',
  }
}
