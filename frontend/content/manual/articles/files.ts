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
              ["[[부서 문서함]]", "내 부서(겸직 부서 포함)의 결재 완료·반려 문서"],
              ["[[전사 문서함]]", "폴더별 승인 완료 문서. 견적·계약·공문 등은 전 직원이 보고, 인사·회계·성과급·근태 폴더는 관리자·인사/회계 담당·대표이사에게만 보입니다."],
            ],
          },
          { kind: "list", items: [
            "[[보존만료]] 열은 완료일에 양식별 보존 연한을 더한 날짜입니다. 지난 문서는 ‘(만료)’로 표시됩니다.",
            "목록은 최근 문서부터 일정 건수까지 보여 줍니다. 오래된 문서는 연도·기간을 지정해 찾으세요.",
          ] },
        ],
      },
      {
        id: "issued",
        title: "보낸 공문·견적·계약서 보기",
        blocks: [
          {
            kind: "table",
            head: ["탭", "누가 보나"],
            rows: [
              ["[[발송공문]]", "전 직원이 보고 PDF·한글 파일을 내려받습니다. 재발송·수신처 편집·이관 등록 삭제는 결재 운영 담당만 합니다."],
              ["[[발송견적]]", "전 직원이 봅니다. 수주 결과 기입은 결재 운영 담당만 합니다."],
              ["[[계약 문서]]", "계약서·변경계약서는 전 직원이 모든 계약의 것을 봅니다. 세금계산서 등 그 밖의 서류는 내가 볼 수 있는 계약의 것만 보입니다."],
            ],
          },
          { kind: "warn", text: "문서 삭제는 결재 운영 담당(관리자·인사/회계)만 할 수 있습니다." },
        ],
      },
    ],
    keywords: ["문서함", "완료 문서", "보존", "발송공문", "발송견적", "참조 문서", "계약서", "과거 공문", "열람 권한"],
    sources: ["components/approval/ApprovalArchiveBoard.tsx", "components/approval/LetterRecordsTable.tsx"],
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
          ] },
        ],
      },
    ],
    keywords: ["개인문서함", "내 파일", "파일 보내기", "용량", "증명서"],
    sources: ["components/files/PersonalDocsBoard.tsx"],
    reviewedAt: "2026-10-20",
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
          { kind: "warn", text: "보존 기간이 지난 파일은 ‘보존기간 경과’로 표시되고, 매일 한 번 자동 삭제 작업에서 지워집니다(복구 불가, 하루 최대 1,000건)." },
        ],
      },
    ],
    keywords: ["파일함", "첨부 파일", "보존 기간", "파일 삭제", "저장 정책"],
    sources: ["components/files/FileLibraryBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
];
