import type { ManualArticle } from "../types";

export const MAIL_ARTICLES: ManualArticle[] = [
  {
    id: "mail.box",
    chapter: "mail",
    title: "메일함 — 읽기·정리·수신 확인",
    routes: ["/mail"],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "받은 메일을 읽고 답장·전달합니다. 메일을 할 일로 바로 만들 수 있습니다.",
      "여러 통을 골라 읽음·스팸·삭제·보관(카테고리 분류)을 한꺼번에 합니다.",
      "[[수신 확인]]에서 내가 보낸 메일을 누가 언제 열어 봤는지 확인합니다.",
      "[[메일 설정]]에서 스팸 키워드, 보관 용량 배분, 다른 메일 가져오기를 설정합니다.",
    ],
    sections: [
      {
        id: "read",
        title: "읽고 정리하기",
        blocks: [
          { kind: "image", src: "/manual/shots/mail-list.webp", alt: "메일 화면 — 왼쪽 편지함과 가운데 메일 목록" },
          { kind: "p", text: "넓은 화면은 기본이 목록형입니다. 왼쪽 폴더 옆에 목록이 한 줄씩 보이고, 메일을 누르면 그 자리에 본문이 열립니다([[목록]]으로 복귀). 목록 위 보기 버튼으로 좌우 분할(가운데 목록·오른쪽 본문)로 바꿀 수 있습니다. 좁은 화면에서는 폴더가 위쪽 탭으로 바뀝니다." },
          { kind: "p", text: "목록은 한 화면에 50개씩 보이며, 오른쪽 아래에서 20·30·50개씩을 고르고 쪽 번호로 넘깁니다. 읽지 않은 메일은 보낸 사람·제목이 굵게 표시됩니다." },
          {
            kind: "table",
            head: ["폴더", "목록 위 일괄 버튼"],
            rows: [
              ["[[받은편지함]]", "[[읽음]] · [[안읽음]] · [[스팸]] · [[삭제]] · [[보관]]"],
              ["휴지통", "[[복원]] · [[영구삭제]]"],
              ["스팸함", "[[스팸 해제]] · [[삭제]]"],
            ],
          },
          { kind: "list", items: [
            "[[보관]]은 메일을 지우지 않고 내가 만든 카테고리 폴더로 옮겨 분류하는 기능입니다.",
            "본문 오른쪽 위 ⋯ 메뉴에 [[전체답장]], [[할 일로 만들기]], [[스팸 분류]], [[분류 해제]]가 있습니다.",
            "[[할 일로 만들기]]를 누르면 이 메일이 연결된 할 일이 만들어집니다.",
          ] },
          { kind: "warn", text: "[[삭제]]는 휴지통으로 옮기기만 합니다. 휴지통에서 [[영구삭제]]하면 되돌릴 수 없습니다." },
        ],
      },
      {
        id: "receipts",
        title: "수신 확인",
        blocks: [
          { kind: "p", text: "[[수신 확인]]에는 내가 보낸 메일마다 ‘확인 n/m’과 받는 사람별 처음 연 시각·열람 횟수가 나옵니다." },
          { kind: "tip", text: "받는 쪽 메일 프로그램이 이미지를 막으면 열어 봐도 ‘미확인’으로 남을 수 있습니다. 중요한 메일은 회신으로 확인하세요." },
        ],
      },
      {
        id: "settings",
        title: "메일 설정",
        blocks: [
          { kind: "list", items: [
            "스팸 메일 설정: 제목·보낸 주소에 키워드가 있으면 스팸으로 분류합니다. 스팸함 보관 기간과 기간 경과 후 처리를 정합니다.",
            "보관함 용량 배분: 받은편지함·보낸편지함·보관함 비율을 정합니다. 합계가 100%여야 저장됩니다.",
            "메일 가져오기: 예전 메일(아마란스 ZIP, 지메일 mbox, 다른 메일 계정)을 가져옵니다. 같은 메일은 한 번만 저장됩니다. 아마란스 ZIP 은 읽음 정보가 없어 받은 메일이 모두 안읽음으로 들어옵니다(지메일·메일 계정은 원래 읽음 상태 유지).",
          ] },
          { kind: "warn", text: "스팸 ‘즉시 삭제’를 켜면 스팸으로 분류된 메일이 바로 지워져 되돌릴 수 없습니다." },
        ],
      },
    ],
    keywords: ["메일", "이메일", "받은편지함", "스팸", "수신 확인", "읽음 확인", "보관", "카테고리"],
    sources: ["components/mail/MailBoard.tsx", "components/mail/MailFolderPane.tsx", "components/mail/MailListPane.tsx", "components/mail/MailViewerPane.tsx", "components/mail/MailReceiptsPane.tsx", "components/mail/MailSettingsPane.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "mail.compose",
    chapter: "mail",
    title: "메일 쓰기 — 첨부·서명·임시 저장",
    routes: ["/mail/compose"],
    requires: [],
    audience: ["staff", "head", "exec", "admin"],
    summary: [
      "받는 사람은 이름이나 주소 일부만 입력해도 주소록에서 찾아 줍니다.",
      "파일은 끌어다 놓거나 [[내 PC]] 또는 [[문서함]](개인문서함)으로 첨부합니다. 큰 파일은 자동으로 다운로드 링크로 바뀝니다.",
      "작성 중인 메일은 [[임시 저장]]을 눌러야 저장됩니다(자동 저장 없음).",
    ],
    sections: [
      {
        id: "write",
        title: "쓰고 보내기",
        blocks: [
          { kind: "image", src: "/manual/shots/mail-compose.webp", alt: "메일 쓰기 화면" },
          { kind: "steps", items: [
            "[[새로 작성]] → [[새 메일]] 또는 메일함의 [[메일 쓰기]]를 누릅니다.",
            "[[받는 사람]]을 입력합니다. 필요하면 [[참조(CC)]]·[[숨은 참조(BCC)]] 입력란을 엽니다.",
            "제목과 본문을 쓰고, 필요하면 메일 서명을 고릅니다.",
            "[[보내기]]를 누릅니다.",
          ] },
          { kind: "tip", text: "숨은 참조로 넣은 사람은 다른 수신자에게 보이지 않습니다." },
        ],
      },
      {
        id: "attach",
        title: "첨부 파일 크기",
        blocks: [
          {
            kind: "table",
            head: ["방법", "파일 1개 최대"],
            rows: [
              ["끌어다 놓기", "30MB"],
              ["[[내 PC]]로 고르기", "2GB"],
              ["[[문서함]]에서 고르기", "2GB(개인문서함 파일)"],
            ],
          },
          { kind: "steps", items: [
            "[[문서함]]을 누르면 [[개인문서함에서 첨부]] 창이 열립니다.",
            "보낼 파일을 체크하고(이름으로 검색 가능) [[선택 파일 첨부]]를 누르면 첨부 목록에 추가됩니다.",
          ] },
          { kind: "list", items: [
            "일반 첨부 합계가 25MB를 넘으면 넘친 파일은 ‘대용량 · 링크’로 바뀝니다. 파일은 회사 저장소에 올라가고 본문에 30일짜리 다운로드 링크가 들어갑니다.",
            "보안 정책으로 막힌 확장자(실행 파일 등)는 첨부할 때 자동으로 빠집니다.",
          ] },
        ],
      },
      {
        id: "draft",
        title: "임시 저장",
        blocks: [
          { kind: "p", text: "메일 쓰기 화면은 자동 저장이 없습니다. 쓰다가 자리를 비울 때는 [[임시 저장]]을 누르세요. 저장한 메일은 임시보관함에서 이어 씁니다." },
          { kind: "tip", text: "서명에 회사명이 지정돼 있으면 제목 앞에 [회사명]이 자동으로 붙습니다." },
        ],
      },
    ],
    keywords: ["메일 쓰기", "첨부", "대용량", "서명", "참조", "숨은 참조", "임시 저장", "보내기"],
    sources: ["components/mail/MailComposePage.tsx", "components/mail/RecipientInput.tsx", "components/mail/MailListPane.tsx", "components/layout/TopBar.tsx"],
    reviewedAt: "2026-10-21",
  },
];
