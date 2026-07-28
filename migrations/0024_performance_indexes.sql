-- 조회 패턴에 맞는 인덱스 보강.
--
-- room_participants의 기본키는 (room_id, user_id)라 user_id만으로 조회할 때는
-- 인덱스를 탈 수 없다. 그런데 "내 면접방 목록"과 "문서 열람 권한 확인"은
-- 모두 user_id로만 찾기 때문에 매번 전체 스캔이 발생한다.
CREATE INDEX idx_room_participants_user ON room_participants(user_id);

-- 계정 정지·비밀번호 재설정·삭제 시 해당 사용자의 세션을 모두 지운다.
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- 면접방 생성자 기준 조회(알림 대상 확인 등).
CREATE INDEX idx_interview_rooms_company ON interview_rooms(company_user_id);
