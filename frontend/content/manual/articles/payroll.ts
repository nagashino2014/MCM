import type { ManualArticle } from "../types";

export const PAYROLL_ARTICLES: ManualArticle[] = [
  {
    id: "payroll.my",
    chapter: "payroll",
    title: "내 급여명세서",
    routes: ["/payroll/my"],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "확정된 급여대장 기준으로 월별 지급·공제·실지급액을 봅니다.",
      "행을 누르면 오른쪽에 그 달 명세서가 열리고, 출력할 수 있습니다.",
      "연도별 수령액 차트와 항목별 합계를 봅니다.",
    ],
    sections: [
      {
        id: "monthly",
        title: "월별 명세서와 수신 확인",
        blocks: [
          { kind: "list", items: [
            "관리자가 대장을 확정하기 전 달은 보이지 않습니다.",
            "[[수신 확인]] 열: [[발행 대기]](아직 발행 전) → [[발행됨 · 미열람]] → 열람 일시.",
            "발행된 명세서를 처음 열면 열람 시각이 회사에 기록됩니다. 화면에 들어왔을 때 자동으로 열리는 최신 달도 열람으로 기록됩니다.",
            "[[이전 월 명세서]] / [[다음 월 명세서]]로 달을 넘기고, 출력 버튼으로 인쇄합니다.",
            "상여·인턴 명세서에는 배지가 붙습니다.",
          ] },
          { kind: "tip", text: "금액이 이상하면 해당 달을 열어 둔 채 급여 담당자에게 문의하세요." },
        ],
      },
    ],
    keywords: ["급여", "월급", "급여명세서", "명세서", "실지급", "공제", "상여"],
    sources: ["components/payroll/MyPayrollBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "payroll.my-yearend",
    chapter: "payroll",
    title: "내 연말정산",
    routes: ["/payroll/my-yearend"],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "홈택스 간소화 자료(PDF)와 소득·세액공제신고서(엑셀)를 올립니다.",
      "계산 결과(총급여·기납부·결정세액·환급/추가 납부)와 원천징수영수증을 봅니다.",
      "직인이 찍힌 원천징수영수증이 필요하면 [[발급 신청]]합니다.",
    ],
    sections: [
      {
        id: "upload",
        title: "자료 올리기",
        blocks: [
          { kind: "steps", items: [
            "[[귀속연도]]를 고릅니다.",
            "[[홈택스 간소화 자료(PDF)]]와 [[소득·세액공제신고서(엑셀)]]를 올립니다.",
            "의료비·기부금 영수증처럼 간소화 자료에 없는 증빙은 [[기타 증빙]]에서 종류를 고르고 올립니다.",
          ] },
          { kind: "p", text: "올린 자료 목록의 [[반영]]은 계산에 들어간 자료, [[보관]]은 보관만 된 자료입니다." },
        ],
      },
      {
        id: "result",
        title: "결과와 영수증",
        blocks: [
          {
            kind: "table",
            head: ["상태", "뜻"],
            rows: [
              ["[[급여대장 대기]]", "그해 급여대장이 아직 확정되지 않음"],
              ["[[자료 수집 중]]", "자료를 받는 중"],
              ["[[계산됨]]", "계산은 됐지만 확정 전 — 바뀔 수 있음"],
              ["[[정산 확정]]", "회사가 확정함"],
            ],
          },
          { kind: "list", items: [
            "원천징수영수증은 [[세무대리인 원본]]이 등록돼 있으면 그것을, 없으면 앱이 계산한 요약본을 보여 줍니다.",
            "[[직인본 발급 신청]]을 누르면 증명신청서 기안이 내용이 채워진 채 열립니다. 승인되면 개인문서함으로 받습니다.",
          ] },
        ],
      },
    ],
    keywords: ["연말정산", "원천징수영수증", "간소화", "환급", "추가 납부", "공제"],
    sources: ["components/payroll/MyYearendBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
];
