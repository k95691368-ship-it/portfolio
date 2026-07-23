-- 같은 공고에 같은 이메일로 '심사 대기(submitted)' 지원이 중복 생성되는 것을
-- DB 차원에서 방지 (동시 제출 경쟁조건 방어). 불합격/합격 후에는 재지원 가능하도록
-- status='submitted' 인 행에만 적용하는 부분 유니크 인덱스.
CREATE UNIQUE INDEX idx_applications_one_submitted
  ON applications(posting_id, applicant_email)
  WHERE status = 'submitted';
