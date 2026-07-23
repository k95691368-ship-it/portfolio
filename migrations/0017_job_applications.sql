-- 채용 공고 + 공개 지원 시스템

-- 채용 공고 (채용자/관리자가 등록)
CREATE TABLE job_postings (
  id TEXT PRIMARY KEY,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  department TEXT,          -- 부서/조직 (예: Enterprise)
  employment_type TEXT,     -- 고용형태 (정규직/인턴/계약직 등)
  location TEXT,            -- 근무지
  description TEXT NOT NULL, -- 상세 설명
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_job_postings_status ON job_postings(status, created_at);
CREATE INDEX idx_job_postings_creator ON job_postings(created_by_user_id);

-- 공개 지원서 (로그인 없이 이메일을 식별자로 제출)
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  posting_id TEXT NOT NULL REFERENCES job_postings(id),
  applicant_name TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  applicant_phone TEXT NOT NULL,
  career_json TEXT,           -- 경력사항 (JSON 배열)
  application_source TEXT,     -- 지원 경로
  cover_letter TEXT,           -- 자기소개/지원동기 (선택)
  -- 개인정보 수집·이용 동의
  consent_required INTEGER NOT NULL DEFAULT 0,    -- 필수항목 (반드시 1)
  consent_optional INTEGER NOT NULL DEFAULT 0,    -- 선택항목
  consent_third_party INTEGER NOT NULL DEFAULT 0, -- 제3자 제공
  consented_at TEXT,
  -- 심사 상태
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'passed', 'rejected')),
  created_user_id TEXT REFERENCES users(id),    -- 서류합격 시 생성된 계정
  room_id TEXT REFERENCES interview_rooms(id),  -- 서류합격 시 생성된 면접방
  reviewed_by_user_id TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_applications_posting ON applications(posting_id, created_at);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_email ON applications(applicant_email);

-- 지원서 첨부파일 (R2 저장, 지원서 id로 연결)
CREATE TABLE application_documents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  doc_type TEXT NOT NULL CHECK (doc_type IN ('resume', 'portfolio')),
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_application_documents_app ON application_documents(application_id);
