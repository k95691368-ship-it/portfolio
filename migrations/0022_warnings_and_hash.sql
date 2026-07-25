-- AI 법적 검토 경고(분석 시 저장) + 서명 계약서 위변조 방지 해시
ALTER TABLE contract_terms ADD COLUMN analysis_warnings_json TEXT;
ALTER TABLE signed_contracts ADD COLUMN sha256_hash TEXT;
