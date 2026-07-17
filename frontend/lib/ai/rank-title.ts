/**
 * 부서/직급 정규화 — LLM(멀티모달) 추출 결과를 결정론적 사전으로 보정.
 * - LLM이 직급을 누락하거나 부서에 "부서+직급"을 몰아넣는 경우를 후처리로 원천 차단.
 * - department 끝에 알려진 직급 토큰이 있으면 title로 이동, title에 부서성 토큰이 섞이면 department로 분리.
 * - 명함 파서에서 사용. 공용이므로 다른 인물 필드 추출에도 재사용 가능.
 */

// 직급/직책 사전(긴 토큰 우선 매칭 위해 길이 내림차순 정렬은 런타임에서 처리).
const RANKS = [
  // 전통 직급
  "대표이사", "부사장", "부회장", "회장", "사장", "전무", "상무보", "상무", "이사대우", "이사",
  "부장대우", "부장", "차장", "과장", "대리", "계장", "주임", "사원",
  "감사", "고문", "자문", "위원장", "위원", "이사장", "국장",
  // 조직 리더 직책
  "본부장", "부문장", "실장", "센터장", "그룹장", "팀장", "파트장", "지점장", "지사장", "공장장", "소장", "총괄", "담당",
  // 연구직
  "수석연구원", "책임연구원", "선임연구원", "주임연구원", "전임연구원", "연구소장", "연구원",
  // 팀제/신직급·직책
  "시니어매니저", "매니저", "프로페셔널", "컨설턴트", "스페셜리스트", "아키텍트", "에반젤리스트",
  "책임", "선임", "수석", "프로", "리더", "리드", "파트너", "시니어", "주니어",
  // 영문 약어
  "CEO", "CTO", "CFO", "COO", "CMO", "CIO", "VP", "PM", "PL", "PO",
];

const RANKS_BY_LEN = [...RANKS].sort((a, b) => b.length - a.length);

// 부서성 접미(이 토큰으로 끝나면 부서로 본다).
const DEPT_TAIL = /(본부|사업부|사업본부|부문|사업소|연구소|센터|그룹|팀|실|파트|지사|지점|공장|담당)$/;

function norm(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

/** 문자열 끝에서 알려진 직급 토큰을 찾아 { rank, rest } 반환(없으면 null). */
function stripTrailingRank(s: string): { rank: string; rest: string } | null {
  for (const rank of RANKS_BY_LEN) {
    // 끝이 "... 부장" / "...부장"(공백 유무) 모두 대응
    const re = new RegExp(`(?:^|\\s|\\/|·|,)${rank}$`);
    if (re.test(s)) {
      const rest = s.replace(new RegExp(`\\s*[\\/·,]?\\s*${rank}$`), "").trim();
      return { rank, rest };
    }
  }
  return null;
}

export interface DeptTitle {
  department: string | null;
  title: string | null;
}

/**
 * 부서/직급을 결정론적으로 보정한다.
 * 1) title이 비었는데 department 끝에 직급이 있으면 → 직급을 title로 이동.
 * 2) title 자체가 "부서 + 직급"으로 뭉쳐 있으면 → 부서를 department로 분리(department가 비어 있을 때만).
 * 3) department 끝의 직급 잔재가 title과 중복되면 department에서 제거.
 */
export function reconcileDeptTitle(input: DeptTitle): DeptTitle {
  let dept = norm(input.department);
  let title = norm(input.title);

  // 2) title 안에 부서성 토큰 + 직급이 뭉친 경우 우선 분리
  if (title) {
    const parts = title.split(/[\/·|]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const rankPart = parts.find((p) => RANKS.includes(p));
      const deptPart = parts.find((p) => DEPT_TAIL.test(p));
      if (rankPart && deptPart) {
        title = rankPart;
        if (!dept) dept = deptPart;
      }
    } else {
      // 구분자 없이 "환경사업본부 부장"처럼 이어진 경우
      const found = stripTrailingRank(title);
      if (found && DEPT_TAIL.test(found.rest) && !dept) {
        dept = found.rest;
        title = found.rank;
      }
    }
  }

  // 1) title이 비었는데 department 끝에 직급이 붙은 경우
  if (!title && dept) {
    const found = stripTrailingRank(dept);
    if (found) {
      title = found.rank;
      dept = found.rest;
    }
  }

  // 3) title이 이미 있는데 department 끝에 같은/다른 직급 잔재가 남은 경우 제거
  if (title && dept) {
    const found = stripTrailingRank(dept);
    if (found) dept = found.rest;
  }

  return { department: dept || null, title: title || null };
}
