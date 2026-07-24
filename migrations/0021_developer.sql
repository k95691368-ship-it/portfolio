-- 개발자(developer) 권한: 관리자 위의 최상위 등급.
-- 관리자 계정을 정지/삭제/비밀번호 재설정할 수 있는 유일한 등급.
-- 개발자 계정 자체는 API로는 누구도 변경/삭제할 수 없다(DB 직접 조작 전용).
ALTER TABLE users ADD COLUMN is_developer INTEGER NOT NULL DEFAULT 0;
