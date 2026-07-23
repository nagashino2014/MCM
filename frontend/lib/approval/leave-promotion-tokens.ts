// 연차촉진 고지 문구 치환 토큰 — 클라이언트/서버 공용(순수 함수, DB 미의존).
// 양식 편집 미리보기와 수신 고지 본문 렌더 양쪽에서 재사용한다.

export interface NoticeTokenVars {
  name: string;
  granted: number;
  used: number;
  remaining: number;
  deadline: string; // YYYY-MM-DD
  noticeDate: string; // YYYY-MM-DD
  planTotal: number; // 사용예정 기재 요망 일수(= 잔여)
}

/** 편집 화면 팔레트에 노출하는 토큰 목록. */
export const NOTICE_TOKENS: { token: string; label: string }[] = [
  { token: "{name}", label: "성명" },
  { token: "{granted}", label: "발생연차" },
  { token: "{used}", label: "사용연차" },
  { token: "{remaining}", label: "잔여연차" },
  { token: "{deadline}", label: "사용기한" },
  { token: "{noticeDate}", label: "고지일자" },
  { token: "{planTotal}", label: "기재요망 일수" },
];

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 문단 하나의 토큰을 치환한다. */
export function fillNoticeText(text: string, v: NoticeTokenVars): string {
  return text
    .replaceAll("{name}", v.name)
    .replaceAll("{granted}", fmtNum(v.granted))
    .replaceAll("{used}", fmtNum(v.used))
    .replaceAll("{remaining}", fmtNum(v.remaining))
    .replaceAll("{deadline}", v.deadline)
    .replaceAll("{noticeDate}", v.noticeDate)
    .replaceAll("{planTotal}", fmtNum(v.planTotal));
}

/** 문단 배열 전체 치환. */
export function fillNoticeBody(body: string[], v: NoticeTokenVars): string[] {
  return body.map((p) => fillNoticeText(p, v));
}

/** 편집 미리보기용 샘플 값. */
export const SAMPLE_TOKEN_VARS: NoticeTokenVars = {
  name: "홍길동",
  granted: 15,
  used: 6,
  remaining: 9,
  deadline: "2026-12-31",
  noticeDate: "2026-07-01",
  planTotal: 9,
};
