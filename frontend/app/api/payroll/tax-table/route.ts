import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getTaxTableInfo } from "@/lib/payroll/tax";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 간이세액표 버전 관리 (§6-2 — 2026-08-14 사용자 요청 자동 업데이트)
 * 소스: 공공데이터포털 국세청 파일데이터(publicDataPk=15050747, hwpx).
 * 메타 API의 기준일(stdrDe)로 개정 감지 → hwpx 다운로드·표 파싱 → 새 year_version 시딩.
 */

const PUBLIC_DATA_PK = "15050747";
const META_URL = `https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=${PUBLIC_DATA_PK}&publicDataDetailPk=`;
const DETAIL_PK = "uddi:f70a4df8-d316-4765-a895-efc96d6692e9";

interface RemoteMeta {
  stdrYear: number | null; // 기준일의 연도(개정 연도)
  stdrDe: string | null;
  atchFileId: string | null;
  fileName: string | null;
  nextRegist: string | null;
}

async function fetchMeta(): Promise<RemoteMeta> {
  const res = await fetch(META_URL + encodeURIComponent(DETAIL_PK), { cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(`공공데이터포털 응답 오류(${res.status})`), { status: 502 });
  const json = (await res.json()) as {
    dataSetFileDetailInfo?: { stdrDe?: string; nextRegistPrarnde?: string };
    fileDataRegistVO?: { atchFileId?: string; orginlFileNm?: string };
  };
  const stdrDe = json.dataSetFileDetailInfo?.stdrDe ?? null; // 'MM/DD/YYYY'
  const m = stdrDe?.match(/(\d{4})$/);
  return {
    stdrYear: m ? Number(m[1]) : null,
    stdrDe,
    atchFileId: json.fileDataRegistVO?.atchFileId ?? null,
    fileName: json.fileDataRegistVO?.orginlFileNm ?? null,
    nextRegist: json.dataSetFileDetailInfo?.nextRegistPrarnde ?? null,
  };
}

/** hwpx 본표(tbl 중 데이터 행이 가장 많은 표) 파싱 — (이상,미만,가족수1~11) 행 추출 */
function parseHwpxTable(sectionXml: string): Array<{ wageFrom: number; wageTo: number; taxes: number[] }> {
  const rows: Array<{ wageFrom: number; wageTo: number; taxes: number[] }> = [];
  const trBlocks = sectionXml.match(/<hp:tr\b[\s\S]*?<\/hp:tr>/g) ?? [];
  for (const tr of trBlocks) {
    const cells = (tr.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) ?? []).map((tc) =>
      (tc.match(/<hp:t\b[^>]*>([^<]*)<\/hp:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ""))
        .join("")
        .trim()
    );
    if (cells.length < 13) continue;
    const a = cells[0].replace(/,/g, "");
    const b = cells[1].replace(/,/g, "");
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) continue;
    const taxes = cells.slice(2, 13).map((x) => {
      const n = Number(x.replace(/,/g, "").replace(/^-$/, "0"));
      return Number.isFinite(n) ? n : 0;
    });
    if (taxes.length !== 11) continue;
    rows.push({ wageFrom: Number(a) * 1000, wageTo: Number(b) * 1000, taxes });
  }
  return rows;
}

/** GET — 현재 DB 버전 + 원격 개정 확인 */
export async function GET() {
  try {
    await requireAdmin();
    const local = await getTaxTableInfo();
    let remote: RemoteMeta | null = null;
    let updateAvailable = false;
    try {
      remote = await fetchMeta();
      updateAvailable = remote.stdrYear != null && local.yearVersion != null && remote.stdrYear > local.yearVersion;
    } catch {
      remote = null; // 원격 확인 실패는 치명적이지 않음(오프라인 등)
    }
    return NextResponse.json({ local, remote, updateAvailable });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** POST action=update — 개정본 다운로드·파싱·새 버전 시딩 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => ({}));
    if (String(body.action ?? "update") !== "update") {
      return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
    }
    const meta = await fetchMeta();
    if (!meta.atchFileId || !meta.stdrYear) {
      return NextResponse.json({ error: "원격 메타에서 파일 정보를 찾지 못했습니다." }, { status: 502 });
    }
    const local = await getTaxTableInfo();
    if (local.yearVersion != null && meta.stdrYear <= local.yearVersion && body.force !== true) {
      return NextResponse.json({ updated: false, message: `이미 최신입니다(현재 ${local.yearVersion}, 원격 ${meta.stdrYear}).` });
    }
    const fileRes = await fetch(
      `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${encodeURIComponent(meta.atchFileId)}&fileDetailSn=1`,
      { cache: "no-store" }
    );
    if (!fileRes.ok) throw Object.assign(new Error(`파일 다운로드 실패(${fileRes.status})`), { status: 502 });
    const buf = await fileRes.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const section = zip.file(/Contents\/section\d+\.xml/)[0];
    if (!section) {
      return NextResponse.json(
        { error: "개정본 hwpx 구조가 예상과 다릅니다 — 수기 시딩이 필요합니다(스크립트 안내 참조)." },
        { status: 422 }
      );
    }
    const rows = parseHwpxTable(await section.async("string"));
    if (rows.length < 500) {
      return NextResponse.json(
        { error: `표 파싱 결과가 비정상(${rows.length}행)입니다 — 개정본 구조 변경 가능성, 수기 확인 필요.` },
        { status: 422 }
      );
    }
    const version = meta.stdrYear;
    await withDbWrite(async (db) => {
      await db.exec(`DELETE FROM income_tax_brackets WHERE year_version = $1`, [version]);
      for (const r of rows) {
        for (let dep = 1; dep <= 11; dep++) {
          await db.exec(
            `INSERT INTO income_tax_brackets (bracket_id, year_version, wage_from, wage_to, dependents, tax)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [`itb-${version}-${r.wageFrom / 1000}-${dep}`, version, r.wageFrom, r.wageTo, dep, r.taxes[dep - 1]]
          );
        }
      }
    });
    const db = await getDb();
    const n = rowsToObjects(
      await db.exec(`SELECT count(*) AS n FROM income_tax_brackets WHERE year_version = $1`, [version])
    )[0];
    return NextResponse.json({
      updated: true,
      yearVersion: version,
      rows: Number(n?.n ?? 0),
      fileName: meta.fileName,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
