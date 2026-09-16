/**
 * 대행 실적 보고서 발송(254) — 실무자에게 메일·앱 메신저로 보낸다.
 *
 * 대행 실적 보고서는 보고하고 보관하면 끝나는 서류가 아니라, 용역 실무자가 허가 서류를 통합허가시스템에
 * 제출할 때 함께 내야 한다. 그래서 신고서 PDF 가 이력에 붙는 순간 실무자에게 바로 보낸다.
 *
 * - 받는 사람: 수행인력 중 실무(정). 없으면 실무 → 실무(부) 순으로 대신한다(2026-09-16 사용자 결정).
 * - 보내는 사람: 신고를 처리한 사람 본인(메일은 본인 메일함, 메신저는 본인 명의 1:1 대화).
 * - 방식: 이력의 delivery_mode(건별) → 없으면 신고 대기열 설정의 reportDelivery(기본값).
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { createRoom, postFileMessage } from "@/lib/chat/queries";
import { sendMail } from "@/lib/mail/send";
import { readContractDocument } from "@/lib/storage/contract-document-storage";
import { loadFilingSettings, todayKst } from "./store";
import type { AgencyReportKind, ReportDeliveryMode, ReportDeliveryRecipient, ReportDeliveryResult } from "./types";
import { AGENCY_REPORT_KIND_LABEL } from "./types";

/** 실무자 우선순위 — 앞에서부터 찾아 처음 있는 역할의 사람들에게 보낸다. */
const RECIPIENT_ROLES = ["실무(정)", "실무", "실무(부)"];

/** 수행인력 설정 화면 — 계약 상세를 열고 수행인력 모달을 바로 띄운다. */
export function staffingPath(contractId: string): string {
  return `/contracts?contract=${encodeURIComponent(contractId)}&open=staffing`;
}

/** 계약의 실무자 — 재직 중이고 참여가 끝나지 않은 사람. 우선순위가 가장 높은 역할 하나의 사람들을 돌려준다. */
export async function resolveReportRecipients(contractId: string): Promise<ReportDeliveryRecipient[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT sp.role_label, e.name, e.email, e.user_id
         FROM service_participants sp
         JOIN employee_profiles e ON e.employee_id = sp.employee_id
        WHERE sp.contract_id = $1
          AND sp.role_label = ANY($2::text[])
          AND COALESCE(e.status, 'active') = 'active'
          AND (COALESCE(sp.participated_to, '') = '' OR sp.participated_to >= $3)
        ORDER BY sp.created_at ASC`,
      [contractId, RECIPIENT_ROLES, todayKst()]
    )
  );
  for (const role of RECIPIENT_ROLES) {
    const picked = rows.filter((r) => String(r.role_label) === role);
    if (picked.length) {
      return picked.map((r) => ({
        name: String(r.name ?? ""),
        email: r.email ? String(r.email) : null,
        userId: r.user_id ? String(r.user_id) : null,
        role,
      }));
    }
  }
  return [];
}

function channelsOf(mode: ReportDeliveryMode): ("mail" | "messenger")[] {
  if (mode === "both") return ["mail", "messenger"];
  if (mode === "mail" || mode === "messenger") return [mode];
  return [];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/**
 * 이력 1건을 발송한다. modeOverride 가 있으면 그 방식으로(수동 [발송]), 없으면 건별 → 기본값 순.
 * 결과를 이력의 delivery_* 에 기록하고 돌려준다. PDF 가 아직 없으면 보내지 않는다(null).
 */
export async function deliverAgencyReport(
  reportId: string,
  actorUserId: string,
  modeOverride?: ReportDeliveryMode | null
): Promise<ReportDeliveryResult | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.report_id, r.contract_id, r.report_kind, r.reported_on, r.receipt_no, r.delivery_mode,
              d.storage_key, d.display_name, c.contract_title
         FROM contract_agency_reports r
         JOIN contracts c ON c.contract_id = r.contract_id
         LEFT JOIN contract_documents d ON d.document_id = r.document_id
        WHERE r.report_id = $1`,
      [reportId]
    )
  );
  const row = rows[0];
  if (!row) throw Object.assign(new Error("신고 이력을 찾을 수 없습니다."), { status: 404 });
  if (!row.storage_key) return null; // 신고서 PDF 가 붙어야 보낼 수 있다

  const contractId = String(row.contract_id);
  const settings = await loadFilingSettings();
  const mode: ReportDeliveryMode =
    modeOverride ?? ((row.delivery_mode as ReportDeliveryMode | null) || settings.reportDelivery);

  const record = async (result: ReportDeliveryResult) => {
    await withDbWrite(async (w) => {
      await w.run(
        `UPDATE contract_agency_reports
            SET delivery_status = $2,
                delivered_at = $3,
                delivery_detail = $4::jsonb,
                updated_at = $5
          WHERE report_id = $1`,
        [
          reportId,
          result.status,
          result.status === "sent" ? new Date().toISOString() : null,
          JSON.stringify({ channels: result.channels, recipients: result.recipients, error: result.error, mode: result.mode }),
          new Date().toISOString(),
        ]
      );
    });
    return result;
  };

  const base = { mode, channels: [] as ("mail" | "messenger")[], recipients: [] as ReportDeliveryRecipient[], error: null as string | null, staffingPath: null as string | null };
  if (mode === "hold") return record({ ...base, status: "held" });

  const recipients = await resolveReportRecipients(contractId);
  if (!recipients.length) {
    return record({
      ...base,
      status: "no_recipient",
      staffingPath: staffingPath(contractId),
      error: "실무자가 설정되지 않았습니다 — 수행인력에서 실무(정)을 지정하면 보낼 수 있습니다.",
    });
  }

  const pdf = await readContractDocument(String(row.storage_key));
  if (!pdf) return record({ ...base, recipients, status: "failed", error: "신고서 PDF 를 읽지 못했습니다." });

  const title = String(row.contract_title ?? "");
  const kindLabel = AGENCY_REPORT_KIND_LABEL[String(row.report_kind) as AgencyReportKind] ?? String(row.report_kind);
  const fileName = String(row.display_name || `${title} 대행실적보고(${kindLabel}).pdf`);
  const receipt = row.receipt_no ? ` · 보고회차 ${row.receipt_no}` : "";
  const errors: string[] = [];
  const sentChannels: ("mail" | "messenger")[] = [];

  for (const channel of channelsOf(mode)) {
    if (channel === "mail") {
      const to = recipients.filter((r) => r.email).map((r) => ({ name: r.name, address: r.email as string }));
      if (!to.length) {
        errors.push("메일: 실무자 메일 주소가 없습니다");
        continue;
      }
      const res = await sendMail({
        userId: actorUserId,
        to,
        subject: `[대행 실적보고서] ${title} — ${kindLabel} 보고`,
        bodyHtml:
          `<p>${esc(recipients.map((r) => r.name).join(", "))} 님, 안녕하세요.</p>` +
          `<p>아래 용역의 대행 실적 보고(${esc(kindLabel)})를 통합환경허가시스템에 제출했습니다.<br>` +
          `허가 서류를 제출할 때 첨부한 실적 보고서를 함께 제출해 주세요.</p>` +
          `<p>· 용역: ${esc(title)}<br>· 보고일: ${esc(String(row.reported_on))}${esc(receipt)}</p>`,
        attachments: [{ filename: fileName, contentType: "application/pdf", content: pdf }],
        idempotencyKey: `agency-report:${reportId}:mail:${to.map((t) => t.address).join(",")}`,
      }).catch((e) => ({ ok: false, error: (e as Error).message }) as { ok: boolean; error?: string; duplicate?: boolean });
      if (res.ok || (res as { duplicate?: boolean }).duplicate) sentChannels.push("mail");
      else errors.push(`메일: ${res.error ?? "발송 실패"}`);
    } else {
      const targets = recipients.filter((r) => r.userId && r.userId !== actorUserId);
      if (!targets.length) {
        // 받는 사람이 처리자 본인뿐이면 메신저로 자기 자신에게 보낼 수 없다 — 실패가 아니라 건너뛴다
        if (recipients.some((r) => r.userId === actorUserId)) continue;
        errors.push("메신저: 실무자 계정이 연결되어 있지 않습니다");
        continue;
      }
      let ok = 0;
      for (const t of targets) {
        try {
          const { roomId } = await createRoom(actorUserId, [t.userId as string]);
          await postFileMessage(
            roomId,
            actorUserId,
            { buffer: pdf, fileName, contentType: "application/pdf", byteSize: pdf.length },
            `[대행 실적보고서] ${title} — ${kindLabel} 보고${receipt}\n허가 서류 제출 시 함께 제출해 주세요.`
          );
          ok += 1;
        } catch (e) {
          errors.push(`메신저(${t.name}): ${(e as Error).message}`);
        }
      }
      if (ok) sentChannels.push("messenger");
    }
  }

  return record({
    ...base,
    recipients,
    channels: sentChannels,
    status: sentChannels.length ? "sent" : "failed",
    error: errors.length ? errors.join(" / ") : null,
  });
}
