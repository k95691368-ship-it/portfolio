// 지원자 한 명이 보는 "내 지원서가 어디까지 왔는가" (순수 함수 — 단위 테스트 대상).
//
// 지금까지 지원자는 접수번호를 들고 공개 조회 화면에서 한 건씩 확인해야 했다.
// 서류합격으로 계정이 생긴 뒤에도, 로그인해서 볼 수 있는 것은 면접방 목록뿐이라
// "내가 지원한 공고"와 "그 지원이 지금 어느 단계인지"가 이어지지 않았다.
//
// 채용 절차는 접수 → 서류 심사 → 면접 → 계약 체결로 이어진다. 각 지원서가
// 그중 어디에 있는지를 한 가지 규칙으로 정리한다.

export const STEP_KEYS = ['submitted', 'screened', 'interview', 'contract']

const STEP_LABELS = {
  submitted: '지원서 접수',
  screened: '서류 심사',
  interview: '면접 진행',
  contract: '근로계약 체결',
}

// 면접방 상태 → 몇 번째 단계까지 왔는가
function stageFromRoom(roomStatus) {
  if (roomStatus === 'signed') return 3
  if (roomStatus) return 2
  return null
}

// 전형 종료를 이 화면이 몰랐다.
//
// 회사가 다른 사람을 채용해 전형을 끝내면 방은 closed 가 되고 지원자에게 알림도
// 간다. 그런데 지원자가 자기 지원 현황을 열면 여전히 "면접이 진행 중입니다"가
// 떠 있었다. 끝났다고 말할 자리를 만들어 놓고, 정작 지원자가 가장 자주 보는
// 화면에서는 끝나지 않은 것처럼 보였다.
function isClosedRoom(roomStatus) {
  return roomStatus === 'closed'
}

// row: { status, createdAt, reviewedAt, roomId, roomStatus, signedAt }
export function describeApplicationProgress(row) {
  const rejected = row?.status === 'rejected'
  const passed = row?.status === 'passed'
  const closed = isClosedRoom(row?.roomStatus)

  // 도달한 단계 (0부터). 불합격은 서류 심사에서 멈춘다.
  let reached = 0
  if (rejected) {
    reached = 1
  } else if (passed) {
    reached = stageFromRoom(row?.roomStatus) ?? 1
  }

  const at = {
    submitted: row?.createdAt ?? null,
    screened: row?.reviewedAt ?? null,
    interview: row?.roomId ? (row?.reviewedAt ?? null) : null,
    contract: row?.roomStatus === 'signed' ? (row?.signedAt ?? null) : null,
  }

  // 전형이 멈춘 자리. 불합격은 서류 심사에서, 전형 종료는 그 방이 와 있던
  // 단계에서 멈춘다. 멈춘 단계는 '진행 중'이 아니라 '멈춤'으로 표시한다.
  const stoppedAt = rejected ? 1 : closed ? reached : null

  const steps = STEP_KEYS.map((key, i) => {
    let state
    if (stoppedAt !== null && i > stoppedAt) state = 'upcoming'
    else if (i === stoppedAt) state = 'stopped'
    else if (i < reached) state = 'done'
    else if (i === reached) state = 'current'
    else state = 'upcoming'
    return { key, label: STEP_LABELS[key], state, at: at[key] }
  })

  let headline
  if (rejected) headline = '이번 전형에서는 함께하지 못하게 되었습니다.'
  else if (closed) headline = '이 전형은 종료되었습니다. 면접방에서 사유와 지금까지의 기록을 볼 수 있습니다.'
  // 보관된 방은 대화도 서명도 잠겨 있다. 그것을 모른 채 "서명해주세요"라고
  // 재촉하면, 지원자는 하라는 대로 눌러 보고 아무 일도 일어나지 않는 것을
  // 자기 잘못으로 여긴다. 할 일 안내는 무언가 할 수 있을 때만 뜻이 있다.
  else if (row?.roomArchived)
    headline = '면접방이 보관되어 대화와 계약서 작업이 잠겨 있습니다. 지금까지의 기록은 그대로 볼 수 있습니다.'
  else if (row?.roomStatus === 'signed') headline = '근로계약 체결이 완료되었습니다.'
  else if (row?.roomStatus === 'contract_pending') headline = '채용이 확정되었습니다. 계약서를 확인하고 서명해주세요.'
  else if (row?.roomId) headline = '면접이 진행 중입니다.'
  else if (passed) headline = '서류 전형에 합격했습니다. 면접방 안내를 기다려주세요.'
  else headline = '지원서를 검토하고 있습니다.'

  return {
    reached,
    steps,
    headline,
    // 지원자가 지금 무엇을 할 수 있는지로 바로 이어준다.
    // 종료돼도 기록은 볼 수 있다. 무슨 일이 있었는지 확인할 길까지 막지 않는다.
    link: row?.roomId
      ? !closed && (row?.roomStatus === 'contract_pending' || row?.roomStatus === 'signed')
        ? `/rooms/${row.roomId}/contract`
        : `/rooms/${row.roomId}`
      : null,
    linkLabel: row?.roomId
      ? closed
        ? '종료된 전형 보기'
        : row?.roomStatus === 'signed'
          ? '체결된 계약서 보기'
          : row?.roomStatus === 'contract_pending'
            ? '계약서 확인·서명하기'
            : '면접방 들어가기'
      : null,
  }
}

// 여러 지원서를 진행 중인 것부터 보여준다. 끝난 건(불합격·체결 완료)은 뒤로.
export function sortMyApplications(list) {
  const weight = (a) => {
    if (a.status === 'rejected') return 3
    if (isClosedRoom(a.roomStatus)) return 3
    if (a.roomStatus === 'signed') return 2
    if (a.roomId) return 0
    return 1
  }
  return [...(list || [])].sort((a, b) => {
    const w = weight(a) - weight(b)
    if (w !== 0) return w
    return String(b.createdAt).localeCompare(String(a.createdAt))
  })
}
