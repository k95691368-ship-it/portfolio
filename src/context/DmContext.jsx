import { createContext, useContext } from 'react'

export const DmContext = createContext(null)

// 로그인하지 않은 화면에서도 부를 수 있어야 한다. 관리자 패널만 쓰는 것이
// 아니라 앞으로 다른 화면에서도 이름을 누르게 될 것이므로, 없으면 아무것도
// 하지 않는 껍데기를 돌려준다.
const NOOP = {
  threads: [],
  unreadTotal: 0,
  inboxLoading: false,
  inboxLoaded: false,
  inboxError: '',
  open: null,
  listOpen: false,
  alerts: [],
  openDm: () => {},
  closeDm: () => {},
  toggleList: () => {},
  dismissAlert: () => {},
  refresh: () => {},
}

export function useDm() {
  return useContext(DmContext) || NOOP
}
