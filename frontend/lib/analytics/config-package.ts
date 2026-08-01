import { listFolders, listForms, saveFolder, saveForm } from "@/lib/approval/forms";
import { listSemanticConcepts, saveSemanticConcepts } from "@/lib/approval/semantic-concepts-store";
import { listMetrics, saveMetric } from "@/lib/analytics/metric-store";
import type { SemanticConceptItem } from "@/lib/approval/semantic-concepts";
import type { MetricItem } from "@/lib/analytics/metric-types";
import type { ApprovalFieldDef } from "@/lib/approval/fields";

/*
 * 설정 패키지 export/import(서버 전용) — SW-P4 SaaS 채비(§9).
 * 양식(폴더+필드 스키마) + 데이터 의미 사전 + 지표 정의를 하나의 JSON 으로 내보내고/들여온다.
 * = "하드코딩 세팅 없는 커스터마이즈"의 실체: 고객사(테넌트) 간 복제·파트너 구축·백업의 단위.
 * import 는 upsert 만 한다(기존 항목 삭제 없음 — 파괴적 동작 배제). 양식은 saveForm 경유라
 * 필드 검증·version 증가·스냅샷이 그대로 적용된다.
 */

export interface ConfigPackage {
  packageVersion: 1;
  exportedAt: string;
  folders: { folderId: string; name: string; sortOrder: number }[];
  forms: {
    formId: string;
    folderId: string | null;
    name: string;
    description: string | null;
    fields: ApprovalFieldDef[];
    docNoRule: string | null;
    retentionYears: number | null;
    orgFolder: string | null;
    deptFolder: string | null;
    useYn: boolean;
  }[];
  concepts: SemanticConceptItem[];
  metrics: Omit<MetricItem, "version" | "updatedAt" | "createdBy">[];
}

export async function exportConfigPackage(): Promise<ConfigPackage> {
  const [folders, forms, concepts, metrics] = await Promise.all([
    listFolders(),
    listForms(true),
    listSemanticConcepts(false),
    listMetrics(false),
  ]);
  return {
    packageVersion: 1,
    exportedAt: new Date().toISOString(),
    folders,
    forms: forms.map((f) => ({
      formId: f.formId,
      folderId: f.folderId,
      name: f.name,
      description: f.description,
      fields: f.fields,
      docNoRule: f.docNoRule,
      retentionYears: f.retentionYears,
      orgFolder: f.orgFolder,
      deptFolder: f.deptFolder,
      useYn: f.useYn,
    })),
    concepts,
    metrics: metrics.map((m) => ({
      metricKey: m.metricKey,
      label: m.label,
      description: m.description,
      definition: m.definition,
      visibility: m.visibility,
      active: m.active,
    })),
  };
}

export interface ImportSummary {
  folders: number;
  forms: number;
  concepts: number;
  metrics: number;
  errors: string[];
}

/** 패키지 적용(upsert) — 항목별 실패는 errors 로 모으고 나머지는 계속 진행한다. */
export async function importConfigPackage(pkg: ConfigPackage, actorUserId: string): Promise<ImportSummary> {
  if (pkg?.packageVersion !== 1) throw new Error("지원하지 않는 패키지 버전입니다.");
  const summary: ImportSummary = { folders: 0, forms: 0, concepts: 0, metrics: 0, errors: [] };

  for (const f of pkg.folders ?? []) {
    try {
      await saveFolder({ folderId: f.folderId, name: f.name, sortOrder: f.sortOrder });
      summary.folders++;
    } catch (err) {
      summary.errors.push(`폴더 ${f.name}: ${(err as Error).message}`);
    }
  }
  for (const f of pkg.forms ?? []) {
    try {
      await saveForm({
        formId: f.formId,
        folderId: f.folderId,
        name: f.name,
        description: f.description,
        fields: f.fields,
        docNoRule: f.docNoRule,
        retentionYears: f.retentionYears,
        orgFolder: f.orgFolder,
        deptFolder: f.deptFolder,
        useYn: f.useYn,
        actorUserId,
      });
      summary.forms++;
    } catch (err) {
      summary.errors.push(`양식 ${f.name}: ${(err as Error).message}`);
    }
  }
  if (Array.isArray(pkg.concepts) && pkg.concepts.length) {
    try {
      // 사전은 전체 교체 저장 API 를 재사용하되, 기존 항목 삭제를 피하기 위해 기존+신규를 병합한다.
      const current = await listSemanticConcepts(false);
      const byKey = new Map(current.map((c) => [c.key, c]));
      for (const c of pkg.concepts) byKey.set(c.key, c);
      summary.concepts = (await saveSemanticConcepts([...byKey.values()], actorUserId)) ?? 0;
    } catch (err) {
      summary.errors.push(`의미 사전: ${(err as Error).message}`);
    }
  }
  for (const m of pkg.metrics ?? []) {
    try {
      await saveMetric(m, actorUserId);
      summary.metrics++;
    } catch (err) {
      summary.errors.push(`지표 ${m.metricKey}: ${(err as Error).message}`);
    }
  }
  return summary;
}
