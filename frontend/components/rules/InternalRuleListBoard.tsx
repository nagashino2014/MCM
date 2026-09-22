"use client";

// 내부 규정 일람(/rules/internal) — 좌측 규정 목록 · 우측 선택한 규정 본문 표시창(2026-09-22 사용자 요청).
// 전 임직원은 시행 중인 판을, 관리 권한자(rules.manage)는 작성 중인 판까지 본다.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FileDown, FilePlus2, Loader2, PencilLine, Search } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { InternalRuleView } from "@/components/rules/InternalRuleView";
import { downloadExport } from "@/lib/flowdoc/download";
import { formatRegNo, type RuleBody, type RuleDocumentRow, type RuleVersionRow } from "@/lib/rules/types";
import "@/components/cdash/cdash.css";

interface InternalDoc extends RuleDocumentRow {
  versions: RuleVersionRow[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  in_consent: "동의 진행",
  published: "시행 중",
  superseded: "지난 판",
};

const STATUS_TONE: Record<string, string> = {
  draft: "var(--cd-warning)",
  in_consent: "var(--cd-primary)",
  published: "var(--cd-success)",
  superseded: "var(--cd-faint)",
};

/** 목록에 보일 대표 판 — 시행 중인 판, 없으면 최신 판 */
function primaryVersion(d: InternalDoc): RuleVersionRow | null {
  return d.versions.find((v) => v.status === "published") ?? d.versions[0] ?? null;
}

export function InternalRuleListBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const [docs, setDocs] = useState<InternalDoc[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [docId, setDocId] = useState(sp.get("docId") ?? "");
  const [versionId, setVersionId] = useState("");
  const [body, setBody] = useState<RuleBody | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/rules/internal", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "내부 규정 목록을 불러오지 못했습니다.");
        const list: InternalDoc[] = json.documents ?? [];
        setDocs(list);
        setCanManage(json.canManage === true);
        setDocId((cur) => (cur && list.some((d) => d.docId === cur) ? cur : list[0]?.docId ?? ""));
      } catch (err) {
        setError(err instanceof Error ? err.message : "내부 규정 목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const doc = useMemo(() => docs.find((d) => d.docId === docId) ?? null, [docs, docId]);

  // 규정을 고르면 대표 판으로
  useEffect(() => {
    setVersionId(doc ? primaryVersion(doc)?.versionId ?? "" : "");
  }, [doc]);

  const loadVersion = useCallback(async (id: string) => {
    setBodyLoading(true);
    try {
      const res = await fetch(`/api/rules/versions/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "규정 본문을 불러오지 못했습니다.");
      setBody(json.version.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "규정 본문을 불러오지 못했습니다.");
      setBody(null);
    } finally {
      setBodyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (versionId) void loadVersion(versionId);
    else setBody(null);
  }, [versionId, loadVersion]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return docs;
    return docs.filter((d) =>
      [d.title, d.ownerDept ?? "", formatRegNo(d.regNo)].some((s) => s.toLowerCase().includes(k)),
    );
  }, [docs, q]);

  const version = doc?.versions.find((v) => v.versionId === versionId) ?? null;

  const [exporting, setExporting] = useState<"pdf" | "hwpx" | null>(null);
  const exportFile = async (format: "pdf" | "hwpx") => {
    if (!doc || !body) return;
    setExporting(format);
    try {
      await downloadExport(
        "/api/rules/internal/export",
        {
          header: { title: doc.title, regNo: doc.regNo, ownerDept: doc.ownerDept, approver: doc.approver, enactedDate: doc.enactedDate },
          body,
          format,
        },
        `${doc.title}.${format}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "파일을 만들지 못했습니다.");
    } finally {
      setExporting(null);
    }
  };
  const publishedCount = docs.filter((d) => d.versions.some((v) => v.status === "published")).length;

  return (
    <div className="cdash cd-fields-white min-h-screen p-4 md:p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "사규·내규", href: "/rules" }, { label: "내부 규정 일람" }]}
        title="내부 규정 일람"
        meta={loading ? undefined : `시행 ${publishedCount}건${canManage ? ` · 전체 ${docs.length}건` : ""}`}
        help="사규와 별도로 운영하는 내부 규정입니다. 좌측 목록에서 규정을 고르면 우측에 본문이 표시됩니다. 관리 권한이 있으면 작성 중인 규정과 지난 판도 볼 수 있습니다."
        actions={
          canManage ? (
            <Link href="/rules/internal/edit?new=1" className="cd-btn cd-btn-primary cd-action">
              <FilePlus2 className="w-4 h-4" /> 새 규정 작성
            </Link>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm border" style={{ borderColor: "var(--cd-error)", color: "var(--cd-error)" }}>
          {error}
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* 좌: 목록 */}
        <div className="cd-card p-3 flex flex-col gap-2 self-start lg:sticky lg:top-4" style={{ maxHeight: "calc(100vh - 140px)" }}>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 cd-text-faint pointer-events-none" />
            <input
              className="cd-input w-full"
              style={{ paddingLeft: 32 }}
              placeholder="규정명·번호·주관부서 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="내부 규정 검색"
            />
          </div>
          <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="text-xs py-6 text-center cd-text-faint">불러오는 중…</div>
            ) : !filtered.length ? (
              <div className="text-xs py-6 text-center cd-text-faint">
                {docs.length ? "검색 결과가 없습니다." : "등록된 내부 규정이 없습니다."}
              </div>
            ) : (
              filtered.map((d) => {
                const pv = primaryVersion(d);
                const hasDraft = d.versions.some((v) => v.status === "draft");
                const active = d.docId === docId;
                return (
                  <button
                    key={d.docId}
                    type="button"
                    onClick={() => setDocId(d.docId)}
                    aria-current={active ? "true" : undefined}
                    className="cd-action text-left px-3 py-2.5 border transition-colors"
                    style={{
                      borderColor: active ? "var(--cd-primary)" : "var(--cd-border)",
                      background: active ? "var(--cd-primary-soft)" : "transparent",
                    }}
                  >
                    <div className="text-[11px] font-mono cd-text-faint">{formatRegNo(d.regNo)}</div>
                    <div className="text-[13px] font-semibold cd-text leading-snug mt-0.5 break-keep">{d.title}</div>
                    <div className="flex items-center gap-2 mt-1 text-[11px]">
                      <span className="cd-text-faint truncate">{d.ownerDept ?? "주관부서 미지정"}</span>
                      <span className="ml-auto shrink-0 font-bold" style={{ color: STATUS_TONE[pv?.status ?? "draft"] }}>
                        {STATUS_LABEL[pv?.status ?? "draft"]}
                      </span>
                      {hasDraft && pv?.status !== "draft" && (
                        <span className="shrink-0 font-bold" style={{ color: STATUS_TONE.draft }}>개정안</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 우: 본문 표시창 */}
        <div className="cd-card p-4 md:p-6 min-w-0">
          {!doc ? (
            <div className="py-16 text-center text-sm cd-text-faint">
              {loading ? "불러오는 중…" : "좌측 목록에서 규정을 선택하세요."}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap mb-4 pb-3 border-b" style={{ borderColor: "var(--cd-border)" }}>
                {doc.versions.length > 1 ? (
                  <select
                    className="cd-select"
                    style={{ width: 200 }}
                    value={versionId}
                    onChange={(e) => setVersionId(e.target.value)}
                    aria-label="판 선택"
                  >
                    {doc.versions.map((v) => (
                      <option key={v.versionId} value={v.versionId}>
                        제{v.version}판 ({STATUS_LABEL[v.status]})
                      </option>
                    ))}
                  </select>
                ) : (
                  version && <span className="text-[12px] cd-text">제{version.version}판</span>
                )}
                {version && (
                  <span className="text-[12px] font-bold" style={{ color: STATUS_TONE[version.status] }}>
                    {STATUS_LABEL[version.status]}
                  </span>
                )}
                {version?.effectiveDate && <span className="text-[12px] cd-text-faint">{version.effectiveDate} 시행</span>}
                {version?.revisionNote && <span className="text-[12px] cd-text-faint truncate">· {version.revisionNote}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <button type="button" className="cd-btn cd-action" disabled={!body || exporting != null} onClick={() => void exportFile("pdf")}>
                    <FileDown className="w-4 h-4" /> {exporting === "pdf" ? "만드는 중…" : "PDF"}
                  </button>
                  <button
                    type="button"
                    className="cd-btn cd-action"
                    disabled={!body || exporting != null}
                    onClick={() => void exportFile("hwpx")}
                    title="한글에서 고칠 수 있는 편집용 사본"
                  >
                    <FileDown className="w-4 h-4" /> {exporting === "hwpx" ? "만드는 중…" : "HWPX"}
                  </button>
                </span>
                {canManage && (
                  <button
                    type="button"
                    className="cd-btn cd-action"
                    onClick={() => router.push(`/rules/internal/edit?docId=${encodeURIComponent(doc.docId)}`)}
                  >
                    <PencilLine className="w-4 h-4" /> 편집
                  </button>
                )}
              </div>
              {bodyLoading ? (
                <div className="py-16 flex items-center justify-center gap-2 text-sm cd-text-faint">
                  <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
                </div>
              ) : body ? (
                <InternalRuleView
                  header={{
                    title: doc.title,
                    regNo: doc.regNo,
                    ownerDept: doc.ownerDept,
                    approver: doc.approver,
                    enactedDate: doc.enactedDate,
                  }}
                  body={body}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
