// 뉴스 발주 신호 수집 오케스트레이션. 네이버 뉴스 검색 → Haiku 분류 → facilities 매칭 → 적재.
// 2트랙: 회사명이 facilities(통합허가 대상)와 매칭되면 증설(트랙A, matched), 아니면 신설/신규 리드(트랙B, unmatched).
// DART collect.ts 의 facilities 매칭 패턴 재사용. source='news', news_stage='detailed'.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/ieps/formatters";
import { searchNews, type NewsItem } from "./naver-news-client";
import { classifyNews, type NewsClassification } from "./news-classifier";
import { coreCompanyName, isProcurementProxy, type IntelSignalGrade } from "./signal-extractor";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 발주 신호 검색 키워드(설비투자·신증설 정황). 최신순 수집.
const KEYWORDS = [
  "공장 증설", "공장 신설", "생산시설 투자", "신규 공장 건설",
  "공장 착공", "증설 투자", "공장 신축", "생산라인 증설",
];
const NAVER_THROTTLE_MS = 200;
const HAIKU_THROTTLE_MS = 120;

// Haiku confidence → 신호 등급
const GRADE_BY_CONFIDENCE: Record<NewsClassification["confidence"], IntelSignalGrade> = {
  high: "confirmed",
  medium: "candidate",
  low: "monitoring",
};

export interface CollectNewsOptions {
  keywords?: string[];
  displayPerKeyword?: number; // 키워드당 검색 건수(1~100, 기본 30). 테스트는 소량
  maxClassify?: number; // Haiku 분류 상한(비용·테스트 제어). 미지정=전량
}

export interface CollectNewsResult {
  scanned: number; // 검색으로 모은 유니크 뉴스 수
  classified: number; // Haiku 분류한 뉴스 수
  signals: number; // isSignal=true (발주 신호) 수
  inserted: number; // 신규 저장
  matched: number; // facilities 매칭(증설=트랙A) 수
  newLead: number; // 미매칭(신설=트랙B 신규 리드) 수
  byGrade: Record<IntelSignalGrade, number>;
}

export async function collectNewsSignals(opts: CollectNewsOptions = {}): Promise<CollectNewsResult> {
  const db = await getDb();
  const keywords = opts.keywords?.length ? opts.keywords : KEYWORDS;
  const display = Math.min(Math.max(opts.displayPerKeyword ?? 30, 1), 100);
  const maxClassify = opts.maxClassify != null && opts.maxClassify >= 0 ? opts.maxClassify : Infinity;

  const result: CollectNewsResult = {
    scanned: 0, classified: 0, signals: 0, inserted: 0, matched: 0, newLead: 0,
    byGrade: { confirmed: 0, candidate: 0, monitoring: 0, excluded: 0 },
  };

  // 1) facilities 코어명 매칭 집합(회사명 코어 → facility). 뉴스는 BRN 없어 회사명 매칭.
  const facRows = rowsToObjects(
    await db.exec(`SELECT facility_id, company_name, normalized_company_name FROM facilities`)
  );
  const coreToFac = new Map<string, string>();
  for (const r of facRows) {
    const core = coreCompanyName(String(r.normalized_company_name ?? r.company_name ?? ""));
    if (core.length >= 3 && !coreToFac.has(core)) coreToFac.set(core, String(r.facility_id));
  }

  // 2) 키워드별 최신순 검색 → 유니크(link) 뉴스 수집. 기수집 link 는 Haiku 전에 제외(야간 배치
  //    반복 실행 시 같은 기사 중복 분류 방지 — 비용 절감).
  const seen = new Set(
    rowsToObjects(await db.exec(`SELECT external_id FROM intel_signals WHERE source = 'news'`)).map((r) =>
      String(r.external_id)
    )
  );
  const byLink = new Map<string, NewsItem>();
  for (const kw of keywords) {
    try {
      const { items } = await searchNews(kw, { display, sort: "date" });
      for (const it of items) if (it.link && !seen.has(it.link) && !byLink.has(it.link)) byLink.set(it.link, it);
    } catch {
      // 개별 키워드 실패는 건너뜀
    }
    await sleep(NAVER_THROTTLE_MS);
  }
  const news = [...byLink.values()];
  result.scanned = news.length;

  // 3) Haiku 분류 → 신호만 선별 + 회사명 매칭
  interface Prepared { it: NewsItem; cls: NewsClassification; facilityId: string | null }
  const prepared: Prepared[] = [];
  for (const it of news) {
    if (result.classified >= maxClassify) break;
    const cls = await classifyNews(it.title, it.description);
    result.classified++;
    await sleep(HAIKU_THROTTLE_MS);
    if (!cls || !cls.isSignal) continue;
    result.signals++;
    // 회사명 → facilities 매칭(조달대행 기관 제외)
    let facilityId: string | null = null;
    if (cls.companyName && !isProcurementProxy(cls.companyName)) {
      const core = coreCompanyName(normalizeCompanyName(cls.companyName) ?? cls.companyName);
      if (core.length >= 3) facilityId = coreToFac.get(core) ?? null;
    }
    prepared.push({ it, cls, facilityId });
  }

  // 4) upsert (source='news', news_stage='detailed')
  const nowIso = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    for (const p of prepared) {
      const grade = GRADE_BY_CONFIDENCE[p.cls.confidence];
      const matched = !!p.facilityId;
      const raw = JSON.stringify({
        press: p.it.press, originalLink: p.it.originalLink, description: p.it.description,
        classification: p.cls,
      });
      const signalId = id("isig");
      const ins = rowsToObjects(
        await wdb.exec(
          `INSERT INTO intel_signals
             (signal_id, source, external_id, company_name, report_name, signal_type, signal_grade,
              disclosed_at, url, raw_json, summary, press, news_stage,
              facility_id, match_status, match_type, status, created_at, updated_at)
           VALUES ($1,'news',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'detailed',$12,$13,'direct','new',$14,$14)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING signal_id`,
          [
            signalId, p.it.link, p.cls.companyName, p.it.title, p.cls.signalType, grade,
            p.it.pubDate || null, p.it.link, raw, p.cls.summary, p.it.press,
            p.facilityId, matched ? "matched" : "unmatched", nowIso,
          ]
        )
      );
      if (!ins.length) continue;
      result.inserted++;
      result.byGrade[grade]++;
      if (matched) result.matched++;
      else result.newLead++;
      // 확정(high) 신호만 alerts 고지
      if (grade === "confirmed") {
        await wdb.run(
          `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
           VALUES ('info','intel','news-signal',$1,$2,$3::jsonb,$4)`,
          [
            `${p.cls.companyName ?? "미상"} · ${p.cls.signalType === "new_site" ? "신설" : p.cls.signalType === "expansion" ? "증설" : "투자"} 뉴스`,
            p.cls.summary ?? p.it.title,
            JSON.stringify({ signalId, facilityId: p.facilityId, signalType: p.cls.signalType, grade, track: matched ? "A" : "B" }),
            nowIso,
          ]
        );
      }
    }
    await wdb.run(
      `INSERT INTO intel_collect_state (source, last_run_at, last_cursor, updated_at)
       VALUES ('news',$1,$1,$1)
       ON CONFLICT (source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, updated_at = EXCLUDED.updated_at`,
      [nowIso]
    );
  });

  return result;
}
