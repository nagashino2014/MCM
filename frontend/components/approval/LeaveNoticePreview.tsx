"use client";

// 연차사용촉진 고지서 문서 뷰 — 실제 발송/인쇄되는 서식을 재현한 프리뷰(양식 관리 미리보기·수신 고지서 보기 공용).
// 표·구조는 고정, 문구(제목·문단)만 편집된다. 문서는 흰 종이 스타일로 라이트/다크 무관하게 동일하게 보인다.

interface NoticeInfo {
  name: string;
  granted: number;
  used: number;
  remaining: number;
}

export interface LeaveNoticePreviewProps {
  round: number;
  title: string;
  paragraphs: string[]; // 토큰 치환 완료
  info: NoticeInfo;
  noticeDate: string; // YYYY-MM-DD
  deadline: string; // YYYY-MM-DD
  planTotal: number; // 기재 슬롯 힌트(= 잔여)
  plan?: string[]; // 1차 사용예정일(제출 시)
  assigned?: string[]; // 2차 회사 지정일
  companyName?: string;
  ceoName?: string;
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function fmtKoreanDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return iso ?? "";
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

// 문서 팔레트(인쇄물처럼 흰 종이 고정)
const INK = "#1f2937";
const INK_FAINT = "#6b7280";
const LINE = "#d1d5db";
const HEAD_BG = "#f3f4f6";

export function LeaveNoticePreview({
  round,
  title,
  paragraphs,
  info,
  noticeDate,
  deadline,
  planTotal,
  plan,
  assigned,
  companyName,
  ceoName,
}: LeaveNoticePreviewProps) {
  const dateList = round >= 2 ? assigned ?? [] : plan ?? [];
  const slotLabel = round >= 2 ? "회사 지정 사용일자" : "연차휴가 사용예정일";
  const slotCount = Math.max(dateList.length, Math.min(Math.max(Math.ceil(planTotal), 3), 12));

  return (
    <div
      className="mx-auto w-full"
      style={{ background: "#ffffff", color: INK, borderRadius: 14, border: `1px solid ${LINE}`, boxShadow: "0 8px 30px rgba(0,0,0,.12)", overflow: "hidden", maxWidth: 560 }}
    >
      {/* 문서 헤더 바 */}
      <div className="flex items-center justify-between px-6 py-2.5" style={{ background: HEAD_BG, borderBottom: `1px solid ${LINE}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: INK_FAINT }}>연차사용촉진 고지서</span>
        <span
          style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: round >= 2 ? "#FA896B" : "#5D87FF", borderRadius: 999, padding: "2px 10px" }}
        >
          {round}차 고지
        </span>
      </div>

      <div className="px-8 py-7" style={{ fontFamily: "'Pretendard', system-ui, sans-serif" }}>
        {/* 제목 */}
        <h2 className="text-center" style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.01em", marginBottom: 22 }}>
          {title}
        </h2>

        {/* 대상자 표 */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 22, fontSize: 13 }}>
          <thead>
            <tr>
              {["성명", "발생연차", "사용연차", "잔여연차"].map((h) => (
                <th key={h} style={{ border: `1px solid ${LINE}`, background: HEAD_BG, padding: "8px 6px", fontWeight: 700, color: INK_FAINT }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ textAlign: "center" }}>
              <td style={{ border: `1px solid ${LINE}`, padding: "9px 6px", fontWeight: 700 }}>{info.name || "-"}</td>
              <td style={{ border: `1px solid ${LINE}`, padding: "9px 6px" }}>{fmtNum(info.granted)}일</td>
              <td style={{ border: `1px solid ${LINE}`, padding: "9px 6px" }}>{fmtNum(info.used)}일</td>
              <td style={{ border: `1px solid ${LINE}`, padding: "9px 6px", fontWeight: 700, color: "#5D87FF" }}>{fmtNum(info.remaining)}일</td>
            </tr>
          </tbody>
        </table>

        {/* 본문 문단 */}
        <div className="flex flex-col" style={{ gap: 12 }}>
          {paragraphs.map((p, i) => {
            const marker = p.trimStart().startsWith("▸");
            if (marker) {
              return (
                <div key={i} style={{ fontSize: 13.5, fontWeight: 700, marginTop: 6 }}>
                  {p.replace(/^\s*▸\s*/, "▸ ")}
                </div>
              );
            }
            return (
              <p key={i} style={{ fontSize: 13.5, lineHeight: 1.85, textAlign: "justify", margin: 0 }}>
                {p}
              </p>
            );
          })}
        </div>

        {/* 사용예정일/지정일 기재란 */}
        <div style={{ marginTop: 16, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ background: HEAD_BG, padding: "7px 12px", fontSize: 12, fontWeight: 700, color: INK_FAINT }}>
            {slotLabel} <span style={{ color: INK_FAINT, fontWeight: 500 }}>(총 {fmtNum(planTotal)}일 · {fmtKoreanDate(deadline)}까지)</span>
          </div>
          <div style={{ padding: "12px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px 16px" }}>
            {Array.from({ length: slotCount }).map((_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12.5 }}>
                <span style={{ color: INK_FAINT, width: 16 }}>{i + 1}.</span>
                <span style={{ flex: 1, borderBottom: `1px solid ${dateList[i] ? "transparent" : LINE}`, minHeight: 18, fontWeight: dateList[i] ? 600 : 400 }}>
                  {dateList[i] ? fmtKoreanDate(dateList[i]) : " "}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 고지일자 + 발신 */}
        <div style={{ marginTop: 28, textAlign: "center" }}>
          <div style={{ fontSize: 14, letterSpacing: ".04em" }}>{fmtKoreanDate(noticeDate)}</div>
          <div style={{ marginTop: 12, fontSize: 15, fontWeight: 800 }}>{companyName || "주식회사"}</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>
            대표이사 {ceoName ? spaceOut(ceoName) : ""} <span style={{ color: INK_FAINT }}>(인)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// 이름 글자 사이 여백(직인란 관례) — "홍길동" → "홍 길 동"
function spaceOut(name: string): string {
  return name.split("").join(" ");
}
