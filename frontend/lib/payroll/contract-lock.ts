import { type PgDatabase, rowsToObjects } from "@/lib/db";

/** 서명 상태가 잘못 되돌려진 과거 행도 서명 흔적으로 보호한다. */
export function isContractSigned(contract: Record<string, unknown>): boolean {
  return contract.status === "signed" || Boolean(contract.signed_at) ||
    Boolean(contract.signed_file_storage_key) || Boolean(contract.signed_render_snapshot) ||
    Object.keys((contract.signatures ?? {}) as Record<string, unknown>).length > 0;
}

/** 호출자의 쓰기 트랜잭션에서 검사와 변경이 같은 행 잠금을 공유해야 한다. */
export async function lockContractForWrite(db: PgDatabase, contractId: string): Promise<Record<string, unknown>> {
  const contract = rowsToObjects(await db.exec(
    `SELECT * FROM labor_contracts WHERE contract_id = $1 FOR UPDATE`, [contractId]
  ))[0];
  if (!contract) throw Object.assign(new Error("계약을 찾을 수 없습니다."), { status: 404 });
  return contract;
}

export function assertContractUnsigned(contract: Record<string, unknown>): void {
  if (isContractSigned(contract)) {
    throw Object.assign(new Error("서명 완료된 계약은 수정하거나 삭제할 수 없습니다."), { status: 409 });
  }
}
