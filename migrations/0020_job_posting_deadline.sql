-- 채용 공고 마감일 (YYYY-MM-DD, nullable = 상시 모집).
-- 공개 목록/상세/지원에서 마감일이 지난 공고는 자동으로 노출·접수 중단.
ALTER TABLE job_postings ADD COLUMN deadline TEXT;
