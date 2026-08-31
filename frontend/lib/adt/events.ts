/**
 * ADT캡스 근태 이벤트 로그(태그 단위) 수신·집계(서버 전용, 마이그 200).
 * 캡스 근태 매니저가 매시(기본 28분) export 폴더에 저장하는 txt 를 사내 수집기
 * (scripts/collect-caps-local.mjs)가 /api/internal/adt-events-ingest 로 올리면,
 * 여기서 라인 파싱 → adt_event_raw 적재 → (사번, 일자) 출근/퇴근 집계 →
 * adt_attendance_raw(089) 스테이징 upsert 까지 수행한다. 이후 정규화·산정은
 * 기존 ingestStaging(lib/adt/ingest.ts)이 공용으로 처리한다.
 *
 * 원본 txt 라인(구분자 없음, 컨트롤러 "필드 선택" 순서):
 *   시간(6) · 사원번호(가변 숫자) · 이름(가변) · 근태내역(1) · 카드번호(13) ·
 *   단말기ID(4) · 고정값(없음) · 일자+시간(14)
 *   예) 0907040001이재영50000000000000000520260826090704
 * 근태내역: '1' 출근 · '2' 퇴근 · '5' 출입. 가변 필드(사원번호·이름)가 가운데라
 * 앞 6자리 + 뒤 32자리(1+13+4+14)를 고정으로 잘라내고 남은 가운데를 나눈다.
 */

import { PgDatabase, rowsToObjects } from "@/lib/db";
import type { AdtRawRecord } from "./types";

/** 단말기ID → 설치 위치(2026-08 실측). 리포트·조회용. */
export const TERMINAL_NAMES: Record<string, string> = {
  "0003": "소회의실",
  "0004": "대회의실",
  "0005": "1208호",
  "0006": "1206호 외부",
  "0007": "1206호 내부",
  "0008": "고문실",
  "0009": "대표실",
};

/** 근태내역 코드. */
export const EVENT_CODE = { IN: "1", OUT: "2", PASS: "5" } as const;

/** 태그 1건. */
export interface CapsEvent {
  eIdno: string;
  eName: string | null;
  dDate: string; // YYYYMMDD (원본 "일자+시간" 앞 8자리)
  tTime: string; // HHMMSS
  eventCode: string;
  cardNo: string | null;
  terminalId: string;
  eventAtIso: string; // KST(+09:00) ISO8601
  sourceFile?: string; // 수신 파일명(추적용)
  rawLine?: string; // 원문 라인(무손실 보존용)
}

/** 뒤쪽 고정폭: 근태내역(1) + 카드번호(13) + 단말기ID(4) + 일자+시간(14). */
const TAIL_LEN = 1 + 13 + 4 + 14;

/**
 * txt 한 줄 → CapsEvent. 형식이 어긋나면 null(호출부가 invalid 로 집계).
 * 앞 6자리(시간)와 "일자+시간" 뒤 6자리가 일치해야 유효로 본다(가변 필드 경계 오판 방어).
 */
export function parseCapsEventLine(line: string): CapsEvent | null {
  const s = line.trim();
  if (s.length < 6 + 1 + TAIL_LEN) return null;

  const dt = s.slice(-14);
  const terminalId = s.slice(-18, -14);
  const cardNo = s.slice(-31, -18);
  const eventCode = s.slice(-32, -31);
  const head = s.slice(0, -TAIL_LEN);
  const tTime = head.slice(0, 6);

  if (!/^\d{14}$/.test(dt) || !/^\d{4}$/.test(terminalId) || !/^\d$/.test(eventCode)) return null;
  if (!/^\d{6}$/.test(tTime) || dt.slice(8) !== tTime) return null;

  const mid = head.slice(6);
  const m = /^(\d+)(.*)$/.exec(mid);
  if (!m || !m[1]) return null;
  const eIdno = m[1];
  const eName = m[2].trim() || null;

  const dDate = dt.slice(0, 8);
  const iso = `${dDate.slice(0, 4)}-${dDate.slice(4, 6)}-${dDate.slice(6, 8)}T${tTime.slice(0, 2)}:${tTime.slice(2, 4)}:${tTime.slice(4, 6)}+09:00`;
  if (Number.isNaN(Date.parse(iso))) return null;

  return { eIdno, eName, dDate, tTime, eventCode, cardNo, terminalId, eventAtIso: iso };
}

/** 이 시각(HHMMSS) 이전의 태그는 전일 야근의 연장으로 귀속한다(야간 종료 06:00과 동일). */
const OVERNIGHT_CUTOFF = "060000";

/** 'YYYYMMDD' 전일. */
function prevYmd8(d: string): string {
  const ms = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00Z`) - 86_400_000;
  const p = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.getUTCFullYear()}${pad(p.getUTCMonth() + 1)}${pad(p.getUTCDate())}`;
}

/**
 * 이벤트 → (사번, 일자) 출근/퇴근 집계(순수 함수).
 * · 출근 = 당일 첫 진입 태그(출근 '1'·출입 '5' 중 최초). ⚠'1' 우선이 아니다 — 07:06 출입 후
 *   07:20 출근 버튼을 찍으면 첫 진입 07:06 이 실질 출근이고, '1' 우선으로 잡으면 그 이전
 *   태그가 퇴근 후보로 남아 out<in(가짜 철야 23h)이 된다(2026-08-31 조옥환 실측 사고).
 * · 퇴근 = 출근 **이후** 태그만 후보: 퇴근('2') 최후, 없으면 출입('5') 최후(없으면 미정).
 *   아침 오태그('2' 등)가 출근보다 앞서면 퇴근으로 쓰지 않는다 — 당일 태그끼리는
 *   out ≥ in 이 보장되고, 자정 보정(+1일)은 아래 전일 귀속 경로에서만 발생한다.
 * · 새벽(06:00 미만) 태그는 전일에 태그가 있으면 전일 퇴근 후보로 귀속
 *   — out_time 에 새벽 HHMMSS 그대로 저장하면 computeDaily 가 out<in 자정 보정(+1일)한다.
 * 알 수 없는 근태내역 코드는 무시한다(원본은 adt_event_raw 에 보존).
 */
export function aggregateEvents(events: CapsEvent[]): AdtRawRecord[] {
  // 사번 → 일자 → 당일 태그. overnight 는 익일 새벽에서 귀속된 퇴근 후보.
  const byEmp = new Map<string, Map<string, { own: CapsEvent[]; overnight: CapsEvent[] }>>();
  for (const ev of events) {
    if (!byEmp.has(ev.eIdno)) byEmp.set(ev.eIdno, new Map());
    const days = byEmp.get(ev.eIdno)!;
    if (!days.has(ev.dDate)) days.set(ev.dDate, { own: [], overnight: [] });
    days.get(ev.dDate)!.own.push(ev);
  }

  const records: AdtRawRecord[] = [];
  for (const [eIdno, days] of byEmp) {
    // 새벽 태그의 전일 귀속(날짜 오름차순 — 전일 그룹 존재 여부는 원본 태그 기준).
    for (const date of Array.from(days.keys()).sort()) {
      const day = days.get(date)!;
      const early = day.own.filter((e) => e.tTime < OVERNIGHT_CUTOFF);
      if (!early.length) continue;
      const prev = days.get(prevYmd8(date));
      if (!prev || !prev.own.length) continue;
      prev.overnight.push(...early);
      day.own = day.own.filter((e) => e.tTime >= OVERNIGHT_CUTOFF);
    }

    for (const [date, day] of days) {
      if (!day.own.length && !day.overnight.length) continue;
      const codes = (list: CapsEvent[], code: string) => list.filter((e) => e.eventCode === code);
      const minT = (list: CapsEvent[]) => (list.length ? list.reduce((a, b) => (a.tTime <= b.tTime ? a : b)) : null);
      const maxT = (list: CapsEvent[]) => (list.length ? list.reduce((a, b) => (a.tTime >= b.tTime ? a : b)) : null);

      // 출근 = 첫 진입('1'·'5' 중 최초). 퇴근 태그('2')만 있는 날은 출근 미정.
      const inEv = minT([...codes(day.own, EVENT_CODE.IN), ...codes(day.own, EVENT_CODE.PASS)]);

      // 퇴근: 익일 새벽 귀속분이 있으면 그중 최후(당일 저녁보다 늦다), 없으면 당일에서 —
      // 출근 이후 태그만 후보로 삼는다(아침 오태그가 퇴근으로 잡혀 가짜 철야가 되는 것 방지).
      const afterIn = (list: CapsEvent[]) => (inEv ? list.filter((e) => e.tTime > inEv.tTime) : list);
      const outEv =
        maxT(codes(day.overnight, EVENT_CODE.OUT)) ??
        maxT(codes(day.overnight, EVENT_CODE.PASS)) ??
        maxT(afterIn(codes(day.own, EVENT_CODE.OUT))) ??
        maxT(afterIn(codes(day.own, EVENT_CODE.PASS)));

      const name = [...day.own, ...day.overnight].map((e) => e.eName).find((n) => n) ?? null;
      records.push({
        e_idno: eIdno,
        e_name: name,
        d_date: date,
        in_time: inEv?.tTime ?? null,
        out_time: outEv?.tTime ?? null,
      });
    }
  }
  return records;
}

export interface EventIngestResult {
  files: number;
  lines: number; // 비어있지 않은 입력 라인 수
  invalid: number; // 파싱 실패 라인 수
  eventsNew: number; // adt_event_raw 신규 적재 태그 수
  staged: number; // adt_attendance_raw 에 반영(변경)된 (사번, 일자) 수
}

/** 태그를 adt_event_raw 에 적재(멱등 — 동일 태그 재전송은 무시). 신규 건수 반환. */
async function insertEvents(db: PgDatabase, events: CapsEvent[]): Promise<number> {
  let n = 0;
  for (const ev of events) {
    const rows = rowsToObjects(
      await db.exec(
        `INSERT INTO adt_event_raw
           (e_idno, event_at, event_code, terminal_id, d_date, t_time, e_name, card_no, source_file, raw_line, ingested_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (e_idno, event_at, event_code, terminal_id) DO NOTHING
         RETURNING 1 AS inserted`,
        [
          ev.eIdno, ev.eventAtIso, ev.eventCode, ev.terminalId, ev.dDate, ev.tTime,
          ev.eName, ev.cardNo, ev.sourceFile ?? null, ev.rawLine ?? null,
        ]
      )
    );
    n += rows.length;
  }
  return n;
}

/**
 * 집계 결과를 스테이징(adt_attendance_raw)에 반영. 이벤트 경로는 출근/퇴근·성명만 갱신하고
 * 나머지(부서·직급·벤더 산정치 등 엑셀 업로드 값)는 보존한다. 값이 실제로 바뀐 행만
 * processed=false 로 되돌려 재정규화를 유도한다(매시 재집계 시 불필요한 재산정 방지).
 */
async function upsertEventStaging(db: PgDatabase, records: AdtRawRecord[]): Promise<number> {
  let n = 0;
  for (const r of records) {
    const rows = rowsToObjects(
      await db.exec(
        `INSERT INTO adt_attendance_raw (e_idno, e_name, d_date, in_time, out_time, source, ingested_at, processed)
         VALUES ($1,$2,$3,$4,$5,'event', now(), false)
         ON CONFLICT (e_idno, d_date) DO UPDATE SET
           e_name = COALESCE(EXCLUDED.e_name, adt_attendance_raw.e_name),
           in_time = EXCLUDED.in_time,
           out_time = EXCLUDED.out_time,
           source = 'event',
           ingested_at = now(),
           processed = false
         WHERE adt_attendance_raw.in_time IS DISTINCT FROM EXCLUDED.in_time
            OR adt_attendance_raw.out_time IS DISTINCT FROM EXCLUDED.out_time
         RETURNING 1 AS changed`,
        [r.e_idno, r.e_name ?? null, r.d_date, r.in_time ?? null, r.out_time ?? null]
      )
    );
    n += rows.length;
  }
  return n;
}

/**
 * 수신 파일들(원문 텍스트) → 파싱 → 이벤트 적재 → 영향 (사번, 일자) 재집계 → 스테이징 반영.
 * 재집계는 이번 수신분만이 아니라 DB 에 쌓인 해당 구간 태그 전체를 다시 읽어 수행한다
 * (아침 태그는 이전 수신분에만 있을 수 있다). 전 단계 멱등이라 같은 파일 재전송에 안전하다.
 * 호출부(API 라우트)가 이어서 ingestStaging 으로 일별·주별 산정까지 마친다.
 */
export async function ingestCapsEventFiles(
  db: PgDatabase,
  files: Array<{ name: string; content: string }>
): Promise<EventIngestResult> {
  let lines = 0;
  let invalid = 0;
  const parsed: CapsEvent[] = [];
  for (const f of files) {
    for (const line of f.content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      lines += 1;
      const ev = parseCapsEventLine(line);
      if (!ev) {
        invalid += 1;
        continue;
      }
      parsed.push({ ...ev, sourceFile: f.name, rawLine: line.trim() });
    }
  }

  const eventsNew = await insertEvents(db, parsed);

  let staged = 0;
  if (parsed.length) {
    // 영향 구간: 수신 태그의 사번 × [최소일-1, 최대일+1] — 전일 귀속·익일 새벽 반영에 필요한 폭.
    const emps = Array.from(new Set(parsed.map((e) => e.eIdno)));
    const dates = parsed.map((e) => e.dDate).sort();
    const fromDate = prevYmd8(dates[0]);
    const toDate = dates[dates.length - 1];
    const toNext = ((): string => {
      const ms = Date.parse(`${toDate.slice(0, 4)}-${toDate.slice(4, 6)}-${toDate.slice(6, 8)}T12:00:00Z`) + 86_400_000;
      const d = new Date(ms);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    })();

    const all = rowsToObjects(
      await db.exec(
        `SELECT e_idno, e_name, d_date, t_time, event_code, card_no, terminal_id,
                to_char(event_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS"+09:00"') AS event_at_iso
           FROM adt_event_raw
          WHERE e_idno = ANY($1::text[]) AND d_date >= $2 AND d_date <= $3`,
        [emps, fromDate, toNext]
      )
    ).map((r) => ({
      eIdno: String(r.e_idno),
      eName: r.e_name != null ? String(r.e_name) : null,
      dDate: String(r.d_date),
      tTime: String(r.t_time),
      eventCode: String(r.event_code),
      cardNo: r.card_no != null ? String(r.card_no) : null,
      terminalId: String(r.terminal_id),
      eventAtIso: String(r.event_at_iso),
    }));

    staged = await upsertEventStaging(db, aggregateEvents(all));
  }

  return { files: files.length, lines, invalid, eventsNew, staged };
}
