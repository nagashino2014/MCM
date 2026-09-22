import { rowsToObjects, type PgDatabase } from '@/lib/db';
import definition from './journal-use-definition-contract.json';

const unavailable = () => Object.assign(new Error('전표 사용 구조를 확인할 수 없습니다. SQL 설치와 정의 검사를 확인하세요.'), { status: 503, code: 'journal_use_unavailable' });

export async function assertJournalUsePrerequisites(db: PgDatabase, schema: string): Promise<void> {
  if (!/^[a-z][a-z0-9_]*$/.test(schema) || schema.startsWith('pg_')) throw unavailable();
  try {
    const row = rowsToObjects(await db.exec('SELECT finance_assert_journal_use_definitions($1) AS proof', [schema]))[0];
    const proof = typeof row?.proof === 'string' ? JSON.parse(row.proof) : row?.proof;
    if (!proof || proof.version !== 'finance-journal-use-installation-v1' || proof.contractHash !== definition.contractHash
      || proof.functionCount !== definition.contract.functions.length || proof.relationCount !== definition.contract.tables.length
      || proof.structureCount !== definition.contract.strictRelations.length) throw unavailable();
  } catch (error) {
    if ((error as { status?: number }).status === 503) throw error;
    throw unavailable();
  }
}
