import { createHash } from "node:crypto";
import type { PgDatabase } from "@/lib/db";
import reference from "./recognition-definition-contract.json";

/** Server configuration only. Never derive the trusted namespace from a request or
 * an unqualified table. Caller supplies the already locked transaction handle.
 * Checks the fixed function set, selected relation bindings/RLS, and seven exact
 * recognition/journal/audit structures. Other schema constraints and concurrent
 * administrator DDL are outside this installation contract.
 */
export class RecognitionPrerequisitesUnavailable extends Error {
  readonly status = 503;
  readonly code = "recognition_prerequisites_unavailable";
  constructor(readonly diagnostic: string) {
    super("재검토에 필요한 데이터베이스 정의를 확인할 수 없습니다.");
    this.name = "RecognitionPrerequisitesUnavailable";
  }
}

// Only catalog metadata is hashed here. Application JSON/money/proof canonicalization
// uses its own versioned contracts; numeric OIDs are deliberately not persistent inputs.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value), "utf8").digest("hex");
const expectedGuardDigest = digest(reference.guard);

const guardCatalogSql = `SELECT pg_catalog.jsonb_build_object(
 'name',p.proname,'argumentTypes',pg_catalog.oidvectortypes(p.proargtypes),
 'arguments',pg_catalog.pg_get_function_arguments(p.oid),'result',pg_catalog.pg_get_function_result(p.oid),
 'language',(SELECT l.lanname FROM pg_catalog.pg_language l WHERE l.oid=p.prolang),
 'source',p.prosrc,'binary',p.probin,'parsedBody',p.prosqlbody::text,
 'kind',p.prokind::text,'securityDefiner',p.prosecdef,'leakProof',p.proleakproof,
 'strict',p.proisstrict,'returnsSet',p.proretset,'volatility',p.provolatile::text,
 'parallel',p.proparallel::text,'config',p.proconfig,'cost',p.procost::text,'rows',p.prorows::text,
 'support',p.prosupport::oid::text,'variadic',p.provariadic::text,'transforms',p.protrftypes::text
 ) AS definition FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=$1 AND p.proname='finance_assert_r1_definitions'`;

export async function assertRecognitionPrerequisites(db: Pick<PgDatabase, "exec">, schema = "public") {
  if (!/^[a-z][a-z0-9_]*$/.test(schema) || schema.startsWith("pg_")) {
    throw new RecognitionPrerequisitesUnavailable("trusted_schema_invalid");
  }
  try {
    // Verify the verifier itself before calling it. Do not cache a successful read:
    // an older migration can replace definitions while leaving version markers intact.
    const rows = (await db.exec(guardCatalogSql, [schema]))[0]?.values ?? [];
    if (rows.length !== 1 || digest(rows[0][0]) !== expectedGuardDigest) {
      throw new RecognitionPrerequisitesUnavailable("definition_verifier_mismatch");
    }
    const results = await db.exec(`SELECT "${schema}".finance_assert_r1_definitions($1) AS proof`, [schema]);
    const proof = results[0]?.values[0]?.[0] as Record<string, unknown> | undefined;
    if (!proof || proof.version !== reference.contract.version || proof.contractHash !== reference.contractHash ||
        proof.schema !== schema || proof.functionCount !== reference.contract.functions.length ||
        proof.relationCount !== reference.contract.tables.length ||
        proof.structureCount !== reference.contract.strictRelations.length) {
      throw new RecognitionPrerequisitesUnavailable("definition_proof_mismatch");
    }
    return { version: reference.contract.version, contractHash: reference.contractHash,
      schema, functionCount: reference.contract.functions.length,
      relationCount: reference.contract.tables.length, structureCount: reference.contract.strictRelations.length };
  } catch (error) {
    if (error instanceof RecognitionPrerequisitesUnavailable) throw error;
    // A future transaction owner must retry the whole operation, never this probe alone.
    const code = (error as { code?: string })?.code;
    if (code === "40001" || code === "40P01") throw error;
    throw new RecognitionPrerequisitesUnavailable(code === "55000" ? "dependency_definition_mismatch" : "definition_catalog_unavailable");
  }
}
