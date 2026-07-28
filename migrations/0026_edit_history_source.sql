-- 계약 조건이 "어떻게" 바뀌었는지 구분한다.
--
-- 회사가 일방적으로 고친 것과, 지원자가 요청해 회사가 수락한 것은 성격이 다르다.
-- 후자는 양측이 합의한 변경이므로 서명 전 점검에서 "합의와 다름"으로 경고하면
-- 안 된다. 오히려 그 값이 새로운 합의 기준이 된다.
ALTER TABLE contract_edit_history ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
