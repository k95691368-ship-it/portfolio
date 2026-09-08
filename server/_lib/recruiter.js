// 채용 관리 권한 판정 헬퍼.
// role 컬럼은 company/candidate만 존재하고, 관리 권한은 is_admin / is_recruiter 플래그로 표현된다.
// - 관리자(is_admin): 인사 팀장. 모든 공고/지원서 조회·관리.
// - 채용자(is_recruiter): 평사원. 자신이 등록한 공고와 그 지원서만 관리.
// 두 등급 모두 company 계정 위에 부여되어 면접방(회사 측) 생성이 가능해야 한다.
export function canManageRecruiting(user) {
  return !!(user && (user.is_admin || user.is_recruiter))
}

// 특정 공고를 이 사용자가 관리할 수 있는지. 관리자는 전체, 채용자는 본인 공고만.
export function canManagePosting(user, posting) {
  if (!user || !posting) return false
  if (user.is_admin) return true
  return !!user.is_recruiter && posting.created_by_user_id === user.id
}
