import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { PDFDocument, PDFFont, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { convertHwpxToPdf } from "@/lib/agreement/convert";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { decryptPii } from "@/lib/security/pii-crypto";
import { putContractDocument, readContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { uploadPersonalDoc } from "@/lib/files/personal";
import { COMPANY_KO, COMPANY_CEO, COMPANY_ADDRESS, COMPANY_BIZ_NO } from "@/lib/letter/types";
import type { ActionConnector } from "@/lib/approval/actions";

/*
 * 증명서 발급 파이프라인(FRM-P2, 204) — 증명신청서 승인 → 종류별 발급 대기(certificate_issues) 생성 후
 * 승인 액션에서 곧바로 자동 발급까지 시도한다(2026-08-31: 승인만 되고 파일이 안 생기던 문제 —
 * 담당자 수동 발급 대기 구조를 자동 발급으로 전환).
 *  - 재직·경력증명서: 회사 HWPX 서식 채움 → converter 로 PDF 변환 → 직인 날인 → 기안자 개인문서함 전송.
 *  - 원천징수영수증: 앱 보유 연말정산 PDF(yearend_settlements)가 있으면 직인본 자동 생성·전송.
 *  - 갑종근로소득세 납세증명(및 연말정산 PDF 없는 원천징수영수증): 스캔 PDF 업로드가 필요해 발급 대기로 남고,
 *    /approval/certificates 발급 관리 화면에서 담당자가 스캔본을 올려 직인본을 만든다.
 * 자동 발급 실패 건도 발급 대기로 남아 같은 화면에서 수동 처리(재생성) 가능 — 실패 사유는 액션 로그에 남는다.
 */

export const CERT_KINDS = [
  { key: "employment", label: "재직증명서", auto: true },
  { key: "career", label: "경력증명서", auto: true },
  { key: "gapjong", label: "갑종근로소득세 납세증명", auto: false },
  { key: "withholding", label: "원천징수영수증", auto: false },
] as const;
export type CertKind = (typeof CERT_KINDS)[number]["key"];

const kindByLabel = new Map<string, CertKind>(CERT_KINDS.map((k) => [k.label, k.key]));
export const certLabel = (kind: string): string => CERT_KINDS.find((k) => k.key === kind)?.label ?? kind;

function id(): string {
  return `cti-${crypto.randomBytes(6).toString("hex")}`;
}

/* ---------- FRM-P0 커넥터 ---------- */

/** 증명신청서 승인 → 체크 종류별 발급 대기 생성(doc_id+kind 유니크로 멱등). */
export const queueCertificatesConnector: ActionConnector = {
  kind: "hr.queue_certificates",
  label: "증명서 발급 대기 생성",
  description: "승인된 증명신청서의 체크 항목별로 발급 담당자 작업 항목을 만듭니다.",
  slots: [
    { key: "kinds", label: "신청 증명서", required: true, hint: "checkbox 필드 — 종류 라벨 배열" },
    { key: "purpose", label: "용도" },
    { key: "target_year", label: "귀속연도" },
    { key: "copies", label: "매수" },
  ],
  async run(ctx) {
    const raw = ctx.slot("kinds");
    const labels = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const kinds = labels.map((l) => kindByLabel.get(l)).filter((k): k is CertKind => !!k);
    if (!kinds.length) throw new Error("신청된 증명서 종류를 해석하지 못했습니다.");
    const now = new Date().toISOString();
    const copies = Math.max(1, Number(String(ctx.slot("copies") ?? "1").replace(/\D/g, "")) || 1);
    let created = 0;
    await withDbWrite(async (txn) => {
      for (const kind of kinds) {
        await txn.run(
          `INSERT INTO certificate_issues
             (issue_id, doc_id, doc_no, cert_kind, employee_id, user_id, employee_name, purpose, target_year, copies, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
           ON CONFLICT (doc_id, cert_kind) DO NOTHING`,
          [
            id(),
            ctx.docId,
            ctx.docNo,
            kind,
            ctx.drafterEmployeeId,
            ctx.drafterUserId,
            ctx.drafterName,
            ctx.slot("purpose") != null ? String(ctx.slot("purpose")) : null,
            ctx.slot("target_year") != null ? String(ctx.slot("target_year")) : null,
            copies,
            now,
          ]
        );
        created += 1;
      }
    });
    // 대기 생성 직후 자동 발급 — 실패해도 대기 항목은 남아 발급 관리 화면에서 수동 처리한다.
    // 재실행(rerunFormActions) 시 이미 발급·전달된 항목은 status 가드로 건너뛴다(멱등).
    const actor = ctx.drafterUserId ?? "system";
    const outcomes: string[] = [];
    for (const kind of kinds) {
      const issue = await getIssueByDocKind(ctx.docId, kind);
      if (!issue || issue.status !== "pending") continue;
      const label = certLabel(kind);
      try {
        if (issue.auto) {
          await issueAutoCertificate(issue.issueId, actor);
          await deliverCertificate(issue.issueId);
          outcomes.push(`${label} 자동 발급·개인문서함 전송`);
        } else if (kind === "withholding") {
          const issued = await issueWithholdingFromYearend(issue.issueId, actor);
          if (issued) {
            await deliverCertificate(issue.issueId);
            outcomes.push(`${label} 연말정산 PDF 직인본 발급·전송`);
          } else {
            outcomes.push(`${label} 대기(연말정산 PDF 없음 — 스캔 업로드 필요)`);
          }
        } else {
          outcomes.push(`${label} 대기(스캔 PDF 업로드 필요)`);
        }
      } catch (err) {
        outcomes.push(`${label} 자동 발급 실패: ${err instanceof Error ? err.message : String(err)} — 발급 관리에서 수동 처리`);
      }
    }
    return { detail: `발급 대기 ${created}건 생성 — ${outcomes.join(" / ") || kinds.map(certLabel).join(", ")}`, result: { kinds } };
  },
};

/* ---------- 조회 ---------- */

export interface CertificateIssueRow {
  issueId: string;
  docId: string;
  docNo: string | null;
  certKind: string;
  certLabel: string;
  auto: boolean;
  employeeId: string | null;
  userId: string | null;
  employeeName: string | null;
  purpose: string | null;
  targetYear: string | null;
  copies: number;
  status: string;
  fileKey: string | null;
  hwpxKey: string | null;
  issuedAt: string | null;
  deliveredAt: string | null;
  note: string | null;
  createdAt: string;
}

function mapIssue(r: Record<string, unknown>): CertificateIssueRow {
  const kind = String(r.cert_kind);
  return {
    issueId: String(r.issue_id),
    docId: String(r.doc_id),
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    certKind: kind,
    certLabel: certLabel(kind),
    auto: CERT_KINDS.find((k) => k.key === kind)?.auto ?? false,
    employeeId: r.employee_id != null ? String(r.employee_id) : null,
    userId: r.user_id != null ? String(r.user_id) : null,
    employeeName: r.employee_name != null ? String(r.employee_name) : null,
    purpose: r.purpose != null ? String(r.purpose) : null,
    targetYear: r.target_year != null ? String(r.target_year) : null,
    copies: Number(r.copies ?? 1),
    status: String(r.status),
    fileKey: r.file_key != null ? String(r.file_key) : null,
    hwpxKey: r.hwpx_key != null ? String(r.hwpx_key) : null,
    issuedAt: r.issued_at != null ? String(r.issued_at) : null,
    deliveredAt: r.delivered_at != null ? String(r.delivered_at) : null,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at),
  };
}

export async function listCertificateIssues(status?: string): Promise<CertificateIssueRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    status
      ? await db.exec(`SELECT * FROM certificate_issues WHERE status = $1 ORDER BY created_at DESC LIMIT 300`, [status])
      : await db.exec(`SELECT * FROM certificate_issues ORDER BY created_at DESC LIMIT 300`)
  );
  return rows.map(mapIssue);
}

export async function getCertificateIssue(issueId: string): Promise<CertificateIssueRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM certificate_issues WHERE issue_id = $1`, [issueId]));
  return rows.length ? mapIssue(rows[0]) : null;
}

/** 문서+종류로 발급 항목 조회 — 승인 액션의 자동 발급이 방금 만든(또는 기존) 행을 집는다. */
async function getIssueByDocKind(docId: string, kind: CertKind): Promise<CertificateIssueRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM certificate_issues WHERE doc_id = $1 AND cert_kind = $2`, [docId, kind]));
  return rows.length ? mapIssue(rows[0]) : null;
}

/* ---------- 재직·경력증명서 PDF ---------- */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const INK = rgb(0.1, 0.12, 0.18);
const LINE = rgb(0.55, 0.58, 0.64);

interface EmployeeCertData {
  name: string;
  rrn: string | null; // 000000-0000000
  address: string | null;
  deptName: string | null;
  positionName: string | null;
  jobDuties: string | null;
  hiredAt: string | null;
  resignedAt: string | null; // 퇴사자면 종료일
}

async function loadEmployeeCertData(employeeId: string): Promise<EmployeeCertData> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.name, e.resident_registration_encrypted, e.address, e.job_duties, e.hired_at, e.status,
              d.dept_name, p.position_name,
              (SELECT ev.event_date FROM employee_hr_events ev
                WHERE ev.employee_id = e.employee_id AND ev.event_type = 'resignation'
                ORDER BY ev.event_date DESC LIMIT 1) AS resigned_at
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE e.employee_id = $1`,
      [employeeId]
    )
  );
  if (!rows.length) throw new Error("직원 정보를 찾을 수 없습니다.");
  const r = rows[0];
  let rrn: string | null = null;
  if (r.resident_registration_encrypted != null) {
    const digits = decryptPii(String(r.resident_registration_encrypted));
    if (digits && digits.length === 13) rrn = `${digits.slice(0, 6)}-${digits.slice(6)}`;
  }
  return {
    name: String(r.name ?? ""),
    rrn,
    address: r.address != null ? String(r.address) : null,
    deptName: r.dept_name != null ? String(r.dept_name) : null,
    positionName: r.position_name != null ? String(r.position_name) : null,
    jobDuties: r.job_duties != null ? String(r.job_duties) : null,
    hiredAt: r.hired_at != null ? String(r.hired_at) : null,
    resignedAt: r.resigned_at != null ? String(r.resigned_at) : null,
  };
}

const kdate = (iso: string | null): string => {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
};

/** 재직/경력증명서 PDF — 회사 서식(중앙 제목 + 인적사항 표 + 증명 문구 + 발급일 + 회사명·직인). */
async function buildHrCertificatePdf(kind: "employment" | "career", data: EmployeeCertData, issue: CertificateIssueRow): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // 회사 서식이 휴먼명조라 폴백 렌더도 명조 계열(KoPub 바탕)로 맞춘다(2026-09-01).
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const regular = await pdf.embedFont(await readFile(path.join(fontsDir, "kopub-batang-md.ttf")), { subset: true });
  const bold = await pdf.embedFont(await readFile(path.join(fontsDir, "kopub-batang-bd.ttf")), { subset: true });
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const title = kind === "employment" ? "재 직 증 명 서" : "경 력 증 명 서";

  // 발급 번호(신청 문서번호 승계) — 우상단
  page.drawText(`발급번호: ${issue.docNo ?? "-"}`, { x: PAGE_W - 72 - regular.widthOfTextAtSize(`발급번호: ${issue.docNo ?? "-"}`, 9.5), y: PAGE_H - 70, size: 9.5, font: regular, color: INK });

  // 제목
  const titleSize = 26;
  page.drawText(title, { x: (PAGE_W - bold.widthOfTextAtSize(title, titleSize)) / 2, y: PAGE_H - 140, size: titleSize, font: bold, color: INK });

  // 인적사항 표
  const period = `${kdate(data.hiredAt)} ~ ${data.resignedAt ? kdate(data.resignedAt) : "현재"}`;
  const rows: Array<[string, string]> = [
    ["성    명", data.name],
    ["주민등록번호", data.rrn ?? "-"],
    ["주    소", data.address ?? "-"],
    ["소    속", data.deptName ?? "-"],
    ["직    위", data.positionName ?? "-"],
    ...(kind === "career" ? ([["담당 업무", data.jobDuties ?? "-"]] as Array<[string, string]>) : []),
    [kind === "employment" ? "재직 기간" : "근무 기간", period],
    ["용    도", issue.purpose ?? "-"],
  ];
  const tableX = 84;
  const tableW = PAGE_W - tableX * 2;
  const labelW = 128;
  const rowH = 34;
  let y = PAGE_H - 200;
  for (const [label, value] of rows) {
    page.drawRectangle({ x: tableX, y: y - rowH, width: labelW, height: rowH, borderColor: LINE, borderWidth: 0.8, color: rgb(0.95, 0.96, 0.97) });
    page.drawRectangle({ x: tableX + labelW, y: y - rowH, width: tableW - labelW, height: rowH, borderColor: LINE, borderWidth: 0.8 });
    page.drawText(label, { x: tableX + 14, y: y - rowH / 2 - 4, size: 11, font: bold, color: INK });
    let v = value;
    while (regular.widthOfTextAtSize(v, 11) > tableW - labelW - 24 && v.length > 1) v = v.slice(0, -1);
    page.drawText(v, { x: tableX + labelW + 12, y: y - rowH / 2 - 4, size: 11, font: regular, color: INK });
    y -= rowH;
  }

  // 증명 문구
  const phrase = kind === "employment" ? "위 사람은 본사에 재직하고 있음을 증명합니다." : "위 사람은 본사에서 위와 같이 근무하였음을 증명합니다.";
  y -= 64;
  page.drawText(phrase, { x: (PAGE_W - regular.widthOfTextAtSize(phrase, 13)) / 2, y, size: 13, font: regular, color: INK });

  // 발급일
  const today = new Date();
  const dateText = `${today.getFullYear()}년  ${today.getMonth() + 1}월  ${today.getDate()}일`;
  y -= 72;
  page.drawText(dateText, { x: (PAGE_W - regular.widthOfTextAtSize(dateText, 13)) / 2, y, size: 13, font: regular, color: INK });

  // 회사 표기 + 직인(성과급 명세서 배치 규칙 — 이름 오른쪽 끝에 겹침)
  y -= 90;
  const companyLine = `${COMPANY_KO}   대표이사  ${COMPANY_CEO}`;
  const cw = bold.widthOfTextAtSize(companyLine, 15);
  const cx = (PAGE_W - cw) / 2;
  page.drawText(companyLine, { x: cx, y, size: 15, font: bold, color: INK });
  page.drawText(`${COMPANY_ADDRESS}  (사업자등록번호 ${COMPANY_BIZ_NO})`, {
    x: (PAGE_W - regular.widthOfTextAtSize(`${COMPANY_ADDRESS}  (사업자등록번호 ${COMPANY_BIZ_NO})`, 9)) / 2,
    y: y - 20,
    size: 9,
    font: regular,
    color: INK,
  });
  try {
    const stampBytes = await readFile(path.join(process.cwd(), "public", "letter", "stamp.png"));
    const stamp = await pdf.embedPng(stampBytes);
    const stampW = 52;
    const stampH = (stamp.height / stamp.width) * stampW;
    page.drawImage(stamp, { x: cx + cw + 4, y: y - stampH * 0.35, width: stampW, height: stampH, opacity: 0.92 });
  } catch {
    // 직인 파일이 없으면 문안만 — 발급은 계속
  }
  return Buffer.from(await pdf.save());
}

/* ---------- 회사 서식 HWPX 채움(08-26 사용자 제공 원본 서식) ---------- */

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 회사 재직/경력증명서 HWPX 템플릿({{...}} 플레이스홀더) 채움 — 실제 사용하던 서식 그대로. */
async function buildCertificateHwpx(kind: "employment" | "career", data: EmployeeCertData, issue: CertificateIssueRow): Promise<Uint8Array> {
  const file = kind === "employment" ? "certificate-employment.hwpx" : "certificate-career.hwpx";
  const bytes = await readFile(path.join(process.cwd(), "public", "hwpx", file));
  const zip = await JSZip.loadAsync(bytes);
  const sectionPath = "Contents/section0.xml";
  let xml = (await zip.file(sectionPath)?.async("string")) ?? "";
  if (!xml) throw new Error(`${file} 템플릿에 section0.xml 이 없습니다`);

  const today = new Date();
  const dotDate = (iso: string | null): string => (iso ? iso.slice(0, 10).replace(/-/g, ".") : "");
  const values: Record<string, string> =
    kind === "employment"
      ? {
          ADDRESS: data.address ?? "-",
          NAME: data.name,
          RRN: data.rrn ?? "-",
          DEPT: data.deptName ?? "-",
          POSITION: data.positionName ?? "-",
          HIRED_AT: data.hiredAt ? kdate(data.hiredAt) : "-",
          PURPOSE: issue.purpose ?? "-",
          // 원본 서식의 자간 스타일 유지("2026 년     3 월     18 일")
          ISSUE_DATE: `${today.getFullYear()} 년     ${today.getMonth() + 1} 월     ${today.getDate()} 일`,
        }
      : {
          NAME: data.name,
          RRN: data.rrn ?? "-",
          ADDRESS: data.address ?? "-",
          POSITION: [data.deptName, data.positionName].filter(Boolean).join(" ") || "-",
          DUTIES: data.jobDuties ?? "-",
          PERIOD: `${dotDate(data.hiredAt)}. ∼ ${data.resignedAt ? dotDate(data.resignedAt) : "현재"}`,
          PURPOSE: issue.purpose ?? "-",
          ISSUE_DATE: `${today.getFullYear()} 년    ${today.getMonth() + 1} 월    ${today.getDate()}일`,
        };
  for (const [key, value] of Object.entries(values)) {
    xml = xml.replaceAll(`{{${key}}}`, escapeXml(value));
  }
  zip.file(sectionPath, xml);
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/* ---------- 스캔 PDF 직인본 ---------- */

/** 업로드된 스캔 PDF(연말정산 원천징수영수증·납세증명 등) 첫 페이지 우하단에 직인을 얹는다. */
async function stampScannedPdf(buffer: Buffer): Promise<Buffer> {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  pdf.registerFontkit(fontkit);
  const stampBytes = await readFile(path.join(process.cwd(), "public", "letter", "stamp.png"));
  const stamp = await pdf.embedPng(stampBytes);
  const page = pdf.getPage(0);
  const { width } = page.getSize();
  const stampW = 58;
  const stampH = (stamp.height / stamp.width) * stampW;
  page.drawImage(stamp, { x: width - stampW - 60, y: 64, width: stampW, height: stampH, opacity: 0.92 });
  return Buffer.from(await pdf.save());
}

/* ---------- 발급 실행 ---------- */

async function saveIssueFile(issue: CertificateIssueRow, buffer: Buffer, actorUserId: string): Promise<string> {
  const fileName = sanitizeFilename(`${issue.certLabel}_${issue.employeeName ?? ""}_${new Date().toISOString().slice(0, 10)}.pdf`);
  const storageKey = `hr/certificates/${issue.issueId}/${fileName}`;
  await putContractDocument(storageKey, buffer, "application/pdf");
  await withDbWrite(async (txn) => {
    await txn.run(`UPDATE certificate_issues SET status = 'issued', file_key = $2, issued_at = $3, issued_by = $4 WHERE issue_id = $1`, [
      issue.issueId,
      storageKey,
      new Date().toISOString(),
      actorUserId,
    ]);
  });
  return storageKey;
}

/** 재직·경력증명서 자동 생성 — 회사 HWPX 서식 채움 → converter 로 PDF 변환 → 직인 날인.
 *  converter 미가용 시 pdf-lib 직접 렌더(buildHrCertificatePdf) 폴백. HWPX 원본도 함께 저장한다. */
export async function issueAutoCertificate(issueId: string, actorUserId: string): Promise<CertificateIssueRow> {
  const issue = await getCertificateIssue(issueId);
  if (!issue) throw new Error("발급 항목을 찾을 수 없습니다.");
  if (!issue.auto) throw new Error("이 증명서는 스캔본 업로드 방식입니다.");
  if (!issue.employeeId) throw new Error("대상 직원 정보가 없습니다.");
  const kind = issue.certKind as "employment" | "career";
  const data = await loadEmployeeCertData(issue.employeeId);

  const hwpx = await buildCertificateHwpx(kind, data, issue);
  const hwpxName = sanitizeFilename(`${issue.certLabel}_${issue.employeeName ?? ""}.hwpx`);
  const converted = await convertHwpxToPdf(hwpx, hwpxName);
  // 회사 서식 HWPX 에는 (인) 위 직인 이미지가 이미 들어 있다(BinData) — 변환본에 추가 날인하면
  // 우하단에 직인이 중복으로 찍히므로 변환본은 그대로 쓴다(2026-08-31 변환 실측).
  const pdf = converted
    ? Buffer.from(converted)
    : await buildHrCertificatePdf(kind, data, issue); // 폴백 렌더(자체 직인 포함)

  await saveIssueFile(issue, Buffer.from(pdf), actorUserId);
  const hwpxKey = `hr/certificates/${issue.issueId}/${hwpxName}`;
  await putContractDocument(hwpxKey, Buffer.from(hwpx), "application/vnd.hancom.hwpx");
  await withDbWrite(async (txn) => {
    await txn.run(`UPDATE certificate_issues SET hwpx_key = $2 WHERE issue_id = $1`, [issueId, hwpxKey]);
  });
  return (await getCertificateIssue(issueId))!;
}

/** 스캔 PDF 업로드 → 직인본 생성(세무 서류). */
export async function issueStampedCertificate(issueId: string, actorUserId: string, scanned: Buffer): Promise<CertificateIssueRow> {
  const issue = await getCertificateIssue(issueId);
  if (!issue) throw new Error("발급 항목을 찾을 수 없습니다.");
  const stamped = await stampScannedPdf(scanned);
  await saveIssueFile(issue, stamped, actorUserId);
  return (await getCertificateIssue(issueId))!;
}

/** 원천징수영수증 자동 경로 — 앱 보유 연말정산 PDF(yearend_settlements.pdf_key)에 직인을 얹어 발급.
 *  해당 귀속연도 PDF 가 없으면 null(호출부가 스캔 업로드 안내 — 발급 대기 유지). */
export async function issueWithholdingFromYearend(issueId: string, actorUserId: string): Promise<CertificateIssueRow | null> {
  const issue = await getCertificateIssue(issueId);
  if (!issue) throw new Error("발급 항목을 찾을 수 없습니다.");
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT pdf_key FROM yearend_settlements WHERE employee_id = $1 AND target_year = $2 AND pdf_key IS NOT NULL ORDER BY target_year DESC LIMIT 1`,
      [issue.employeeId, Number(issue.targetYear ?? "") || new Date().getFullYear() - 1]
    )
  );
  const pdfKey = rows.length && rows[0].pdf_key != null ? String(rows[0].pdf_key) : null;
  const buf = pdfKey ? await readContractDocument(pdfKey) : null;
  if (!buf) return null;
  return await issueStampedCertificate(issueId, actorUserId, buf);
}

/** 발급본을 기안자 개인문서함으로 전송 + delivered 처리. */
export async function deliverCertificate(issueId: string): Promise<CertificateIssueRow> {
  const issue = await getCertificateIssue(issueId);
  if (!issue) throw new Error("발급 항목을 찾을 수 없습니다.");
  if (!issue.fileKey) throw new Error("발급본이 아직 생성되지 않았습니다.");
  if (!issue.userId) throw new Error("기안자 계정 정보가 없어 전송할 수 없습니다.");
  const buffer = await readContractDocument(issue.fileKey);
  if (!buffer) throw new Error("발급본 파일을 읽지 못했습니다.");
  const fileName = issue.fileKey.split("/").pop() ?? `${issue.certLabel}.pdf`;
  await uploadPersonalDoc(issue.userId, { fileName, contentType: "application/pdf", buffer });
  await withDbWrite(async (txn) => {
    await txn.run(`UPDATE certificate_issues SET status = 'delivered', delivered_at = $2 WHERE issue_id = $1`, [
      issueId,
      new Date().toISOString(),
    ]);
  });
  return (await getCertificateIssue(issueId))!;
}
