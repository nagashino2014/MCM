/**
 * 매뉴얼 검색 — 제목·키워드·절 제목·본문 부분일치 + 제목·키워드 초성 검색. 외부 라이브러리 없음.
 */
import type { ManualArticle, ManualBlock } from "@/content/manual";
import { visibleArticles, visibleSections } from "./match";

const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

/** 한글 음절 → 초성 문자열(그 외 문자는 그대로). */
export function toChosung(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : ch;
  }
  return out;
}

const isChosungQuery = (q: string) => /^[ㄱ-ㅎ\s]+$/.test(q);

/** 인라인 표기([[ ]], ** **)를 걷어낸 평문. */
export function plainText(text: string): string {
  return text.replace(/\[\[(.+?)\]\]/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1");
}

function blockText(block: ManualBlock): string {
  switch (block.kind) {
    case "p":
    case "tip":
    case "warn":
      return block.text;
    case "steps":
    case "list":
      return block.items.join(" ");
    case "table":
      return [...block.head, ...block.rows.flat()].join(" ");
    case "flow":
      return block.items.map((i) => `${i.from} ${i.to}`).join(" ");
    case "link":
      return block.label ?? "";
  }
}

export interface ManualSearchHit {
  article: ManualArticle;
  /** 본문 일치가 난 절(있으면 그 절로 이동). */
  section?: string;
  score: number;
}

export function searchManual(query: string, perms: readonly string[], limit = 12): ManualSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const chosung = isChosungQuery(q) ? q.replace(/\s+/g, "") : null;
  const hits: ManualSearchHit[] = [];

  for (const article of visibleArticles(perms)) {
    let score = 0;
    let section: string | undefined;
    const title = article.title.toLowerCase();
    const keywords = article.keywords.join(" ").toLowerCase();
    const summary = plainText(article.summary.join(" ")).toLowerCase();

    if (chosung) {
      if (toChosung(article.title).replace(/\s+/g, "").includes(chosung)) score = 60;
      else if (article.keywords.some((k) => toChosung(k).replace(/\s+/g, "").includes(chosung))) score = 40;
      if (score > 0) hits.push({ article, score });
      continue;
    }

    for (const term of terms) {
      let termScore = 0;
      if (title.includes(term)) termScore = Math.max(termScore, title.startsWith(term) ? 120 : 100);
      if (keywords.includes(term)) termScore = Math.max(termScore, 60);
      if (summary.includes(term)) termScore = Math.max(termScore, 25);
      for (const s of visibleSections(article, perms)) {
        const sTitle = s.title.toLowerCase();
        const body = plainText(s.blocks.map(blockText).join(" ")).toLowerCase();
        const sScore = sTitle.includes(term) ? 45 : body.includes(term) ? 12 : 0;
        if (sScore > termScore) {
          termScore = sScore;
          section = s.id;
        } else if (sScore > 0 && !section) {
          section = s.id;
        }
      }
      // 모든 단어가 어딘가에 있어야 한다(AND).
      if (termScore === 0) {
        score = 0;
        break;
      }
      score += termScore;
    }
    if (score > 0) hits.push({ article, section: title.includes(terms[0] ?? "") ? undefined : section, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
