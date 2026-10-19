"use client";

// 공통 "권한 없음" 안내(role 일원화 WP5) — 메뉴에 없는 화면을 URL 로 열었거나 버튼 게이트 밖의 기능에 닿았을 때.
// 미들웨어가 /forbidden 으로 rewrite 하거나, 클라이언트 페이지가 can() 판정 실패 시 직접 렌더한다.
// Precision UI(docs/ui-precision-standard.md): 무광 카드·1px 경계·8px 반경, --cd-* 토큰만 사용, 라이트/다크 공통.

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import "@/components/cdash/cdash.css";

/** 권한키 → 사람이 읽는 영역 이름(안내문용). 없으면 키 그대로 보여 준다. */
const KEY_LABEL: Record<string, string> = {
  "account.manage": "계정·권한 관리",
  "rbac.template.manage": "권한 템플릿 관리",
  "rbac.assignment.manage": "권한 부여 관리",
  "org.edit": "회사 프로필 관리",
  "security.access_log": "접속기록 조회",
  "security.attachment_policy": "첨부 확장자 정책",
  "ai.usage.view": "AI API 사용량",
  "recruit.view": "홍보·채용공고",
  "approval.manage": "결재 운영 설정",
  "staffing.edit": "근태·휴가 관리",
  "work_plan.view": "업무추진계획",
  "work_plan.merge": "부서장 감독",
  "work_plan.lock_release": "부서장 감독",
  "work_plan.directive": "임원 검토·지시",
  "bonus.view": "성과급 산정",
  "staffing.record.view": "수행인력 실적",
  "payroll.view": "급여대장",
  "rules.manage": "사규 관리",
  "survey.manage": "외부 설문",
  "facility.view": "사업장",
  "contract.view": "계약",
  "billing.view": "수주/수금/발행 현황",
  "filing.view": "대외 신고 대기열",
  "finance.view": "재무",
  "sales.view": "영업/마케팅",
  "contact.view": "담당자 정보 관리",
  "data.view": "데이터",
  "trash.view": "휴지통",
  "approval.read_all": "전자결재 전 문서 열람",
  "staffing.sensitive.view": "직원 계좌·인사 서류 열람",
};

export function AccessDenied({
  requiredKeys = [],
  path,
  message,
}: {
  /** 이 화면이 요구하는 권한키(하나라도 보유하면 열림). */
  requiredKeys?: readonly string[];
  /** 사용자가 열려던 경로(표시용). */
  path?: string | null;
  /** 기본 안내를 대체할 문장. */
  message?: string;
}) {
  const { theme } = useCdashTheme();
  const labels = [...new Set(requiredKeys.map((k) => KEY_LABEL[k] ?? k))];
  return (
    <div className="cdash flex items-center justify-center min-h-full p-6 md:p-8" data-theme={theme}>
      <div
        role="alert"
        className="cd-card p-8 md:p-10 text-center max-w-md w-full"
        style={{ borderRadius: 8, boxShadow: "none" }}
      >
        <ShieldAlert className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--cd-error)" }} aria-hidden />
        <h2 className="text-lg font-bold cd-text mb-1">이 화면을 볼 권한이 없습니다</h2>
        <p className="text-sm cd-text-muted">
          {message ?? "필요한 권한이 계정에 부여되어 있지 않습니다. 권한은 관리자가 권한 템플릿으로 부여합니다."}
        </p>
        {labels.length > 0 && (
          <p className="mt-3 text-xs cd-text-faint">
            필요한 권한: {labels.join(" · ")}
          </p>
        )}
        {path && (
          <p className="mt-1 text-xs cd-text-faint break-all">
            요청 경로: <span className="font-mono">{path}</span>
          </p>
        )}
        <p className="mt-3 text-xs cd-text-faint">권한이 방금 부여되었다면 로그아웃 후 다시 로그인하면 반영됩니다.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/home" className="cd-btn cd-btn-primary cd-btn-sm">
            홈으로
          </Link>
        </div>
      </div>
    </div>
  );
}
