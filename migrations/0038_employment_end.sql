-- 근로관계가 실제로 끝난 날을 기록한다.
--
-- 근로기준법 제42조의 3년 보존 기간은 시행령 제22조 제2항에 따라 "근로관계가
-- 끝난 날"부터 센다. 그런데 이 앱에는 그 날짜를 담을 자리가 없어, 계약 종료일이
-- 없는 무기계약은 서명일을 기산일로 쓰고 있었다. 재직 중인 근로자의 계약서가
-- 서명 3년 뒤 "보존 종료"로 표시되는, 방향이 정확히 반대인 오류였다.
--
-- 소급해 채우지 않는다. 기록이 없으면 "아직 끝나지 않았다"로 보는 것이 안전한
-- 쪽이고, 실제로도 대부분 그렇다.
ALTER TABLE contract_terms ADD COLUMN employment_ended_at TEXT;
ALTER TABLE contract_terms ADD COLUMN employment_end_reason TEXT;
ALTER TABLE contract_terms ADD COLUMN employment_end_recorded_at TEXT;
ALTER TABLE contract_terms ADD COLUMN employment_end_recorded_by_user_id TEXT REFERENCES users(id);
