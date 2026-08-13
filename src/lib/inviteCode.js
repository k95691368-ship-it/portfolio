// 입장 코드를 다루는 규칙은 서버와 화면이 같아야 한다.
//
// 화면이 하이픈을 넣어 보여 주는데 서버가 하이픈을 못 받아들이면, 화면에
// 보이는 그대로 쳐 넣은 사람이 막힌다. 규칙을 두 벌 쓰지 않고 서버 것을
// 그대로 가져다 쓴다.
export { formatInviteCode, normalizeInviteCode } from '../../functions/_lib/inviteCode.js'
