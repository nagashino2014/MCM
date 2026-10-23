/*
 * 인포그래픽 자동 매칭(블루프린트 §4-3) — 1단계 형태 판별(규칙, 결정적) + 2단계 적합도 점수(규칙). 클라이언트 안전.
 * 3단계 LLM 순위·이유(catalog.infographic_suggest)는 P6 — 없으면 이 점수만으로 정렬한다.
 * 결과: 추천 후보(점수순, 이유 한 줄)와 막힌 유형(이유). 스튜디오 [유형 바꾸기]가 후보를 실제 내용으로 그려 보여 준다.
 */
import { INFO_TYPES, contentFamily, defaultVariant, type InfoBox, type InfoContent, type InfoType, type InfoTypeMeta } from "./types";

export interface InfoCandidate {
  type: InfoType;
  variant: string;
  label: string;
  score: number;
  reason: string;
}

export interface InfoBlocked {
  type: InfoType;
  label: string;
  reason: string;
}

export interface MatchContext {
  box: InfoBox;
  /** 지금 유형 */
  current?: InfoType;
  /** 같은 섹션의 다른 자리에서 쓰는 유형(반복 회피) */
  sectionTypes?: InfoType[];
  /** 이 자리에서 예전에 고른 유형(catalog_infographic_prefs) */
  pref?: InfoType;
}

const CYCLIC = /사후관리|반복|순환|재검토|정기|이행 점검|모니터링|피드백/;
const ORDERED = /단계|절차|접수|작성|협의|신청|취득|진단|분석|검토|제출|심사|검사|계획|설계|시공|운영/;

const len = (s: string | undefined) => (s ?? "").replace(/\s+/g, "").length;

function blockReason(meta: InfoTypeMeta, c: InfoContent): string | null {
  const n = c.items.length;
  const fam = contentFamily(c);
  if (fam === "list" && meta.family === "number") return "수치가 없는 목록이라 수치형 도식으로 바꿀 수 없습니다.";
  if (fam === "number" && meta.family === "list" && meta.type !== "hub" && meta.type !== "network") return "목록형으로 바꾸면 수치가 사라집니다.";
  if (meta.needs === "when" && !c.items.every((it) => it.when)) return "항목마다 시점(연도)이 있어야 합니다.";
  if (meta.needs === "prev" && !c.items.every((it) => it.prev != null)) return "항목마다 이전 값이 있어야 합니다(전후 비교).";
  if (meta.needs === "region" && !c.items.every((it) => it.region)) return "항목마다 권역이 있어야 합니다(지도).";
  if (meta.needs === "four" && n !== 4) return `항목이 정확히 4개여야 합니다(지금 ${n}개).`;
  if (n < meta.min || n > meta.max) return `항목 ${n}개 — 이 유형은 ${meta.min}~${meta.max}개입니다.`;
  if (meta.type === "share" && c.items.some((it) => (it.value ?? 0) <= 0)) return "0 이하 값이 있어 구성비로 그릴 수 없습니다.";
  return null;
}

function pickVariant(meta: InfoTypeMeta, c: InfoContent, box: InfoBox): string {
  const n = c.items.length;
  switch (meta.type) {
    case "process":
      return box.w / Math.max(box.h, 1) < 1.6 && n <= 5 ? "v" : "h";
    case "bar":
      return n > 6 || box.h < 140 ? "h" : "v";
    case "cards":
      return String(n <= 2 ? 2 : box.w > 520 && n % 3 === 0 ? 3 : n >= 4 && box.w > 600 ? 4 : 2);
    case "iconGrid":
      return String(n <= 4 ? 4 : n % 3 === 0 && box.w < 520 ? 3 : n > 8 ? 6 : 4);
    case "share":
      return box.h < 120 ? "stack" : "donut";
    default:
      return defaultVariant(meta.type);
  }
}

export function matchInfographic(c: InfoContent, ctx: MatchContext): { candidates: InfoCandidate[]; blocked: InfoBlocked[] } {
  const candidates: InfoCandidate[] = [];
  const blocked: InfoBlocked[] = [];
  const n = c.items.length;
  const maxLabel = Math.max(0, ...c.items.map((it) => len(it.label)));
  const maxDesc = Math.max(0, ...c.items.map((it) => len(it.desc)));
  const hasDesc = c.items.some((it) => it.desc);
  const text = c.items.map((it) => `${it.label} ${it.desc ?? ""}`).join(" ") + " " + (c.title ?? "");
  const cyclic = CYCLIC.test(text);
  const ordered = ORDERED.test(text);
  for (const meta of INFO_TYPES) {
    const why = blockReason(meta, c);
    if (why) {
      blocked.push({ type: meta.type, label: meta.label, reason: why });
      continue;
    }
    let score = 60;
    const plus: string[] = [];
    const minus: string[] = [];
    // 의미
    if (cyclic && meta.type === "cycle") {
      score += 20;
      plus.push("반복·사후관리 흐름");
    }
    if (ordered && (meta.type === "process" || meta.type === "roadmap")) {
      score += 10;
      plus.push(`순서가 있는 ${n}단계`);
    }
    if (c.center && (meta.type === "hub" || meta.type === "network")) {
      score += 10;
      plus.push("중심 항목이 있음");
    }
    if (meta.family === "number" && contentFamily(c) === "number") {
      if (meta.type === "bar") {
        score += 6;
        plus.push("범주별 수치 비교");
      }
      if (meta.type === "share" && n <= 5) {
        score += 4;
        plus.push("구성 비율");
      }
      if (meta.type === "stats" && n <= 4) {
        score += 2;
        plus.push("큰 숫자로 강조");
      }
    }
    if (meta.type === "timeline" || meta.type === "roadmap") {
      score += 6;
      plus.push("시점이 있음");
    }
    if (meta.type === "compare") {
      score += 14;
      plus.push("전후 값이 있음");
    }
    if (meta.type === "map") {
      score += 4;
      plus.push("권역 분포");
    }
    // 항목 수
    if (n > meta.min && n < meta.max) score += 4;
    // 글자 길이(실측 대신 권장 최대 글자 수)
    if (maxLabel > meta.maxLabel) {
      score -= Math.min(25, (maxLabel - meta.maxLabel) * 3);
      minus.push("라벨이 길어 줄바꿈될 수 있음");
    }
    if (hasDesc && meta.maxDesc === 0) {
      score -= 10;
      minus.push("설명 글은 표시되지 않음");
    } else if (meta.maxDesc > 0 && maxDesc > meta.maxDesc) {
      score -= 8;
      minus.push("설명이 길어 넘칠 수 있음");
    }
    // 자리 크기
    if (ctx.box.h < meta.minHeight) {
      score -= Math.min(30, Math.round((meta.minHeight - ctx.box.h) / 4));
      minus.push("자리가 낮아 넘칠 수 있음");
    } else if (meta.minHeight >= 150 || meta.type === "process") {
      plus.push(ctx.box.w > ctx.box.h * 2 ? "가로 자리에 맞음" : "자리 크기에 맞음");
    }
    if ((meta.type === "cycle" || meta.type === "hub" || meta.type === "network") && ctx.box.w < 300) {
      score -= 15;
      minus.push("자리가 좁음");
    }
    // 선택 기록·반복 회피
    if (ctx.pref === meta.type && ctx.current !== meta.type) {
      score += 10;
      plus.push("이 자리에서 예전에 고른 유형");
    }
    if (ctx.current === meta.type) {
      score += 5;
      plus.unshift("지금 유형");
    }
    if (ctx.sectionTypes?.includes(meta.type) && ctx.current !== meta.type) {
      score -= 6;
      minus.push("같은 섹션에서 이미 씀");
    }
    const reason = [...plus.slice(0, 2), ...minus.slice(0, 1)].join(" · ") || meta.use;
    candidates.push({ type: meta.type, variant: pickVariant(meta, c, ctx.box), label: meta.label, score: Math.max(0, Math.min(100, score)), reason });
  }
  candidates.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
  return { candidates, blocked };
}
