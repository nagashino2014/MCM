import { getDb, rowsToObjects } from "@/lib/db";
import { renderContractPdf } from "@/lib/payroll/contract-pdf";
import { isContractSigned } from "@/lib/payroll/contract-lock";
import { captureContractRenderSnapshot, type ContractRenderSnapshot } from "@/lib/payroll/contract-snapshot";

/** 신규 서명은 서명 당시 입력으로 렌더한다. 기존 보존본 없는 서명을 현재 자료로 재구성하지 않는다. */
export async function buildContractPdfById(contractId: string): Promise<{
  bytes: Uint8Array;
  fileName: string;
} | null> {
  const db = await getDb();
  const contract = rowsToObjects(await db.exec(
    `SELECT * FROM labor_contracts WHERE contract_id = $1`, [contractId]
  ))[0];
  if (!contract) return null;

  let snapshot: ContractRenderSnapshot;
  if (isContractSigned(contract)) {
    snapshot = contract.signed_render_snapshot as ContractRenderSnapshot;
    if (!snapshot || snapshot.version !== 1 || !snapshot.input || !snapshot.fileName) {
      throw Object.assign(new Error("서명 당시 보존본이 없어 원본 확인이 필요합니다. 현재 정보로 서명본을 다시 만들 수 없습니다."), { status: 409 });
    }
  } else {
    snapshot = await captureContractRenderSnapshot(db, contract);
  }
  return { bytes: await renderContractPdf(snapshot.input), fileName: snapshot.fileName };
}
