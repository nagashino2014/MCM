import { createHash } from "node:crypto";
import type { PgDatabase } from "@/lib/db";
import { assertSupplyGroupPrerequisites } from "./supply-group-prerequisites";
import reference from "./vat-use-definition-contract.json";

/** Whole-set review extends the versioned same installation contract, including reverse guards.
 * The versioned R1 and review contracts are checked first; installation authority is generated only from reviewed fixed migration inputs.
 * This checks structure and definition integrity, not the truth of uploaded evidence.
 */
export class VatUsePrerequisitesUnavailable extends Error {
  readonly status = 503;
  readonly code = "vat_use_prerequisites_unavailable";
  constructor(readonly diagnostic: string) {
    super("동일 공급 신고 사용에 필요한 자료구조를 확인할 수 없습니다.");
    this.name = "VatUsePrerequisitesUnavailable";
  }
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value), "utf8").digest("hex");
const expectedGuardDigest = digest(reference.guard);
const guardCatalog = `SELECT pg_catalog.jsonb_build_object(
 'name',p.proname,'argumentTypes',pg_catalog.oidvectortypes(p.proargtypes),
 'arguments',pg_catalog.pg_get_function_arguments(p.oid),'result',pg_catalog.pg_get_function_result(p.oid),
 'language',(SELECT l.lanname FROM pg_catalog.pg_language l WHERE l.oid=p.prolang),
 'source',p.prosrc,'binary',p.probin,'parsedBody',p.prosqlbody::text,
 'kind',p.prokind::text,'securityDefiner',p.prosecdef,'leakProof',p.proleakproof,
 'strict',p.proisstrict,'returnsSet',p.proretset,'volatility',p.provolatile::text,
 'parallel',p.proparallel::text,'config',p.proconfig,'cost',p.procost::text,'rows',p.prorows::text,
 'support',p.prosupport::oid::text,'variadic',p.provariadic::text,'transforms',p.protrftypes::text
 ) AS definition FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=$1 AND p.proname='finance_assert_vat_use_definitions'`;

export async function assertVatUsePrerequisites(db: Pick<PgDatabase, "exec">, schema = "public") {
  try {
    await assertSupplyGroupPrerequisites(db, schema);
    const rows = (await db.exec(guardCatalog, [schema]))[0]?.values ?? [];
    if (rows.length !== 1 || digest(rows[0][0]) !== expectedGuardDigest) throw new VatUsePrerequisitesUnavailable("definition_verifier_mismatch");
    const proof = (await db.exec(`SELECT "${schema}".finance_assert_vat_use_definitions($1) AS proof`, [schema]))[0]?.values[0]?.[0] as Record<string, unknown> | undefined;
    if (!proof || proof.version !== reference.contract.version || proof.contractHash !== reference.contractHash || proof.schema !== schema
      || proof.functionCount !== reference.contract.functions.length || proof.relationCount !== reference.contract.tables.length
      || proof.structureCount !== reference.contract.strictRelations.length) throw new VatUsePrerequisitesUnavailable("definition_proof_mismatch");
    return { version: reference.contract.version, contractHash: reference.contractHash, schema,
      functionCount: reference.contract.functions.length, relationCount: reference.contract.tables.length, structureCount: reference.contract.strictRelations.length };
  } catch (error) {
    if (error instanceof VatUsePrerequisitesUnavailable) throw error;
    const code = (error as { code?: string })?.code;
    if (code === "40001" || code === "40P01") throw error;
    throw new VatUsePrerequisitesUnavailable(code === "55000" ? "dependency_definition_mismatch" : "dependency_unavailable");
  }
}
