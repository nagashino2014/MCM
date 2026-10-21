import type { ManualArticle } from "../types";

export const FILES_ARTICLES: ManualArticle[] = [
  {
    id: "files.archive",
    chapter: "files",
    title: "문서함 — 끝난 결재 문서 찾기",
    routes: ["/approval/archive"],
    requires: ["approval.view"],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "결재가 끝난 문서를 내 문서·부서·전사 범위로 찾아봅니다.",
      "보낸 공문은 [[발송공문]], 보낸 견적서는 [[발송견적]], 계약서 파일은 [[계약 문서]] 탭에서 봅니다.",
      "연도·기간·검색어로 거릅니다.",
    ],
    sections: [
      {
        id: "tabs",
        title: "탭마다 보이는 문서",
        blocks: [
          {
            kind: "table",
            head: ["탭", "보이는 문서"],
            rows: [
              ["[[내 기안 완료]]", "내가 올려 결재가 끝난 문서"],
              ["[[내가 결재한 문서]]", "내가 결재선에서 처리한 문서"],
              ["[[참조·열람]]", "나를 참조·열람으로 넣은 문서. 안 읽은 문서에는 점이 표시됩니다."],
              ["[[부서 문서함]] / [[전사 문서함]]", "부서·전사 범위로 볼 수 있는 완료 문서(권한에 따라)"],
            ],
          },
          { kind: "list", items: [
            "[[보존만료]] 열은 완료일에 양식별 보존 연한을 더한 날짜입니다. 지난 문서는 ‘(만료)’로 표시됩니다.",
            "목록은 최근 500건(발송공문·발송견적은 200건)까지 불러와 한 화면에 50개씩 보여 줍니다. 오른쪽 아래에서 20·30·50개씩과 쪽을 고릅니다. 더 오래된 문서는 연도·기간을 지정해 찾으세요.",
          ] },
        ],
      },
    ],
    keywords: ["문서함", "완료 문서", "보존", "발송공문", "발송견적", "참조 문서"],
    sources: ["components/approval/ApprovalArchiveBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "files.personal",
    chapter: "files",
    title: "개인문서함",
    routes: ["/files/personal"],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "내 파일을 올려 두고 메일·메신저로 보냅니다.",
      "증명서처럼 회사가 발급해 주는 문서도 여기로 들어옵니다.",
      "위쪽 게이지에서 남은 용량을 확인합니다.",
    ],
    sections: [
      {
        id: "use",
        title: "올리고 보내기",
        blocks: [
          { kind: "steps", items: [
            "업로드 버튼을 누르거나 파일을 끌어다 놓습니다.",
            "보낼 파일을 체크하고 전송 버튼을 누릅니다.",
            "[[파일 전송]] 창에서 받는 사람(임직원 또는 거래처 담당자)과 전송 방식을 고른 뒤 [[메일 작성창 열기]] 또는 [[메신저로 보내기]]를 누릅니다.",
          ] },
          { kind: "list", items: [
            "거래처 담당자에게는 메일로만 보낼 수 있습니다.",
            "메일 첨부 합계가 25MB를 넘으면 큰 파일은 다운로드 링크로 바뀝니다.",
            "용량이 90%를 넘으면 [[용량이 거의 찼습니다]] 경고가 나옵니다. 용량은 관리자가 배분합니다.",
            "목록은 한 화면에 50개씩 보이며, 오른쪽 아래에서 20·30·50개씩과 쪽을 고릅니다. 전체 선택은 지금 보이는 쪽의 파일만 고릅니다.",
          ] },
        ],
      },
    ],
    keywords: ["개인문서함", "내 파일", "파일 보내기", "용량", "증명서"],
    sources: ["components/files/PersonalDocsBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "files.library",
    chapter: "files",
    title: "파일함(관리자)",
    routes: ["/files$"],
    requires: ["files.manage"],
    audience: ["admin"],
    summary: [
      "전자결재·메신저·사업장 자료·게시판·업무추진 이슈의 첨부 파일을 한곳에서 찾습니다.",
      "보존 기간이 지난 파일을 정리하고, [[파일 저장 정책]]으로 크기별 보존 기간을 정합니다.",
    ],
    sections: [
      {
        id: "delete",
        title: "삭제와 보존 정책",
        blocks: [
          { kind: "warn", text: "여기서 지운 파일은 **원래 있던 곳(결재 문서·메신저 등)에서도 사라지며 복구할 수 없습니다.** 일괄 삭제는 현재 필터에 걸린 파일 전체가 대상입니다." },
          { kind: "p", text: "[[파일 저장 정책]]에서 [[5MB 이하 파일]] / [[50MB 이하 파일]] / [[50MB 이상 파일]]마다 보존 기간(6개월·1년·5년·영구)을 정하고 [[정책 저장]]을 누릅니다." },
          { kind: "p", text: "목록은 한 화면에 50개씩 보이며, 오른쪽 아래에서 20·30·50개씩과 쪽을 고릅니다." },
          { kind: "warn", text: "보존 기간이 지난 파일은 ‘보존기간 경과’로 표시되고, 매일 한 번 자동 삭제 작업에서 지워집니다(복구 불가, 하루 최대 1,000건)." },
        ],
      },
    ],
    keywords: ["파일함", "첨부 파일", "보존 기간", "파일 삭제", "저장 정책"],
    sources: ["components/files/FileLibraryBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
];
