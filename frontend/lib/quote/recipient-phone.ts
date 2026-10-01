// 견적서 수신 블록 TEL 보완 — 주소록에서 고른 참조 담당자(cc_refs)에 전화번호가 없으면
// 주소록(facility_contact_people)에서 휴대폰 → 회사 전화 순으로 채운다(2026-10-01 사용자 요청).
// 종전에는 주소록 선택 시 전화번호를 넘기지 않아 TEL 이 비었다 — 이미 저장된 문서도 렌더 시점에 보완된다.

import { getDb, rowsToObjects } from "@/lib/db";
import type { QuoteFieldValues } from "./types";

export async function fillRecipientPhones(values: QuoteFieldValues): Promise<QuoteFieldValues> {
  const refs = Array.isArray(values.cc_refs) ? values.cc_refs : [];
  const ids = [...new Set(refs.filter((r) => !r.phone?.trim() && r.contactId && /^\d+$/.test(String(r.contactId))).map((r) => Number(r.contactId)))];
  if (!ids.length) return values;
  try {
    const db = await getDb();
    const rows = rowsToObjects(await db.exec(`SELECT id, office_phone, mobile_phone FROM facility_contact_people WHERE id = ANY($1::bigint[])`, [ids]));
    const phoneById = new Map(
      rows.map((r) => [String(r.id), String(r.mobile_phone ?? "").trim() || String(r.office_phone ?? "").trim()])
    );
    return {
      ...values,
      cc_refs: refs.map((r) => (!r.phone?.trim() && r.contactId && phoneById.get(String(r.contactId)) ? { ...r, phone: phoneById.get(String(r.contactId)) } : r)),
    };
  } catch {
    return values; // 보완 실패는 문서 생성을 막지 않는다(TEL 은 '-' 로 남는다)
  }
}
