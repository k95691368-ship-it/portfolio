// 면접방 입장 코드.
//
// 서류합격한 지원자에게 메일로 보내는 값이고, 그 코드로 면접방에 들어온다.
// 코드를 넣으면 그 방 지원자의 계정 세션이 발급되므로 — 사실상 로그인 수단이다.
// 그래서 세 가지를 지킨다.
//
//   길이. 6자리(32자 알파벳)는 30비트, 약 10억이다. 공격자가 특정 방을 맞힐
//   필요도 없다 — invite_code 는 전역에서 유일하므로 아무 방이나 맞으면 된다.
//   방이 늘수록 기대 시도 횟수가 줄어든다. 12자리면 60비트가 되어 시도 제한과
//   함께 현실적으로 막힌다.
//
//   한 곳. 예전에는 이 함수가 면접방 생성과 서류합격 처리 두 곳에 글자 하나까지
//   같게 복사돼 있었다. 한쪽만 고치면 어느 경로로 만들어졌느냐에 따라 코드
//   강도가 달라지는데, 화면에서는 그 차이가 보이지 않는다.
//
//   읽고 옮겨 적을 수 있을 것. 사람이 메일에서 눈으로 읽어 손으로 치는 값이다.
//   혼동 문자(0/O, 1/I/L)를 빼고, 네 자씩 끊어 보여 준다.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 12

export function genInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  let code = ''
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length]
  return code
}

// 사람이 옮겨 적은 것을 받아들인다.
//
// 하이픈으로 끊어 보여 주므로 하이픈째 붙여 넣는 사람이 있고, 공백이 섞이거나
// 소문자로 치는 사람도 있다. 그걸로 못 들어오게 하면 회사에 다시 물어야 한다.
export function normalizeInviteCode(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

// 메일과 화면에 보여 줄 표기. AC3K-M7PQ-4RTV
export function formatInviteCode(code) {
  const clean = normalizeInviteCode(code)
  if (clean.length <= 6) return clean
  return clean.match(/.{1,4}/g).join('-')
}
