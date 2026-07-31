-- 채용 공고에 근로조건을 구조화해 적는다.
--
-- 지금까지 공고에 담긴 근로조건은 description 자유 텍스트뿐이었다. 그래서
-- 공고를 보고 지원한 사람이 나중에 계약서를 받았을 때, 조건이 공고와 같은지
-- 확인할 방법이 없었다. "월 250만원"이라고 적힌 공고를 보고 지원했는데 계약서에
-- 220만원이 적혀 있어도 앱은 아무것도 알려주지 않았다.
--
-- 채용절차의 공정화에 관한 법률 제4조 제3항은 구인자가 채용광고에서 제시한
-- 근로조건을 구직자에게 불리하게 변경하는 것을 금지한다. 비교할 값이 없으면
-- 그 위반을 알아차릴 수 없다.
--
-- 임금은 표기 방식이 갈리므로 종류를 함께 받는다. 범위로 제시하는 공고가 많아
-- 하한·상한을 나눠 둔다. 하한만 있으면 그것을 약속한 최소로 본다.
ALTER TABLE job_postings ADD COLUMN wage_type TEXT
  CHECK (wage_type IS NULL OR wage_type IN ('monthly', 'hourly', 'annual'));
ALTER TABLE job_postings ADD COLUMN wage_min INTEGER;
ALTER TABLE job_postings ADD COLUMN wage_max INTEGER;
ALTER TABLE job_postings ADD COLUMN work_hours_start TEXT;
ALTER TABLE job_postings ADD COLUMN work_hours_end TEXT;
ALTER TABLE job_postings ADD COLUMN work_days TEXT;
