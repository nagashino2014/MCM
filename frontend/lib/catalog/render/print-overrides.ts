/*
 * 회사소개서 발행본 보정 CSS — 디자인 시스템 CSS(public/catalog-kit/kesi-catalog.css, 사본 그대로) 위에 얹는 것만.
 * 디자인 시스템에 없는 것은 렌더러가 새로 만든 요소 둘뿐이다:
 *   .kc-footnote — 독자용 각주(기준월·지표 정의). 디자인 시스템의 .kc-notes 는 검토용 안내문이라 인쇄·배포본에서 숨겨지므로
 *                  같은 모양의 각주를 따로 둔다(README '쪽 아래 footnote 로 기준월과 정의를 적습니다').
 *   .kc-case__steph — 사례 단계 제목. 목업의 h3 을 북마크에서 빼려고 p 로 바꿨으므로 같은 모양을 클래스로 준다.
 *
 * 모티프 절제(사용자 지시 2026-10-22: "물방울·나뭇잎 모양이 너무 많이 쓰인다, 적절히 줄일 것"):
 *   물방울·잎 모양은 상징 자리 — 표지(kc-front)·섹션 간지(kc-divider)·뒤표지(kc-backc) — 에만 남긴다.
 *   본문 쪽의 요소 모양(쪽 머리 표식·글머리·분야 점·단계 번호·아이콘 상자·카드·사진 틀·연혁 강조점)은
 *   평범한 원·둥근 사각으로 바꾸고, 본문 쪽의 장식 물방울은 컴포넌트에서 뺐다.
 *   ⚠ 디자인 시스템 아티팩트(P1)·목업(P2)에도 같은 규칙을 반영해야 한다(README '모티프' 절).
 */
const BODY = ".pk-sheet:not(.kc-front):not(.kc-divider):not(.kc-backc)";

export const PRINT_OVERRIDES = `
.kc-footnote { list-style: none; padding: 0; margin: 0; display: grid; gap: 1px; font-size: 7.5px; line-height: 11px; color: var(--ink-muted); }
.kc-case__step > .kc-case__steph { font-size: 10px; line-height: 14px; font-weight: 700; color: var(--area); margin: 0; }
.kc-table tr.kc-table__more td { font-size: 8px; color: var(--ink-muted); }
.kc-orbit__card { color: inherit; }
.pk-sheet .kc-toc__folio.is-missing { color: var(--ink-faint); }
.kc-page-title.is-continued .kc-areatag { color: var(--ink-faint); }
/* 상태 표식(●·◐)은 프리텐다드에 ◐ 가 없어 대체 서체로 작게 찍힌다(converter 실측) → 서체와 무관한 도형으로 */
.kc-status::before { content: "" !important; width: 6px; height: 6px; flex: none; border-radius: 50%; box-sizing: border-box; }
.kc-status--done::before { background: currentColor; }
.kc-status--active::before { border: 1px solid currentColor; background: linear-gradient(90deg, currentColor 50%, transparent 50%); }

/* 모티프 절제 — 점·글머리는 모든 쪽에서 원 */
.pk-sheet .kc-areatag::before, .pk-sheet .kc-list li::before, .pk-sheet .kc-sw__list li::before, .pk-sheet .kc-front__areas li::before { border-radius: 50%; }
/* 본문 쪽 요소 모양 */
${BODY} .kc-head__mark { width: 3px; height: 11px; border-radius: 1px; }
${BODY} .kc-iconbox { border-radius: 8px; }
${BODY} .kc-process__num, ${BODY} .kc-map__dot--num { border-radius: 50%; }
${BODY} .kc-timeline > li.is-highlight .kc-timeline__tick { border-radius: 50%; width: 11px; height: 11px; margin: 1px 0 5px; }
${BODY} .kc-photo--frame, ${BODY} .kc-nophoto.kc-photo--frame { border-radius: 12px; }
${BODY} .kc-kpi, ${BODY} .kc-card, ${BODY} .kc-strengths__method, ${BODY} .kc-fx > div { border-radius: 10px; }
${BODY} .kc-strengths__hero { border-radius: 14px; }
${BODY} .kc-person__initial, ${BODY} .kc-person__photo { border-radius: 10px; }
`;
