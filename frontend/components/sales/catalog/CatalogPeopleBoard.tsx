"use client";

// 인물 노출 관리 — 임원진·기술인력(사용자관리 재직자 자동)·직접 입력 임원(촉탁)·자문위원. 사진 게재 동의·순서·소개서 직함·약력 요약.
// 임원 판정 = 직급이 부장보다 높으면 임원, 부장 이하는 직원(lib/catalog/people.ts, 사용자 확인 10-22). 퇴사자는 자동으로 빠진다.
// 고문 등 근로계약 없이 촉탁(자문) 계약을 맺은 임원은 사용자관리에 없어 직접 입력한다.
// docs/company-catalog-blueprint.md §6-2·§6-6

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageUp, Pencil, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdTabs } from "@/components/cdash/CdTabs";
import { CdModal } from "@/components/cdash/CdModal";
import type { DisplayOverride } from "@/lib/catalog/appendix";
import type { CatalogAdvisor, CatalogPerson } from "@/lib/catalog/people";
import { EXTRA_EMPLOYMENT_TYPES, type CatalogExtraPerson } from "@/lib/catalog/people-types";
import type { LeaderCardFields } from "@/lib/catalog/render/data";
import { catalogFetch } from "./catalogFetch";
import "@/components/cdash/cdash.css";
import { CatalogBackLink } from "./CatalogBackLink";

type TabKey = "exec" | "staff" | "advisors";

const emptyAdvisor: Omit<CatalogAdvisor, "advisorId"> & { advisorId: string | null } = {
  advisorId: null,
  name: "",
  field: "",
  org: "",
  title: "",
  career: "",
  orderNo: 0,
  isPublic: true,
};

/** 소개서에 실릴 사진 주소 — 소개서 전용 사진 → 인사 사진 순 */
function photoSrc(p: CatalogPerson): string | null {
  if (p.meta?.photoAssetId) return `/api/catalog/assets/${encodeURIComponent(p.meta.photoAssetId)}`;
  return p.photoPath;
}

const emptyExtra: Omit<CatalogExtraPerson, "personId"> & { personId: string | null } = {
  personId: null,
  name: "",
  roleLabel: "고문",
  employmentType: "촉탁",
  bioShort: "",
  career: "",
  edu: "",
  cert: "",
  photoAssetId: null,
  photoConsent: null,
  orderNo: null,
  isPublic: true,
  countInTotal: true,
};

export function CatalogPeopleBoard() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<TabKey>("exec");
  const [people, setPeople] = useState<CatalogPerson[]>([]);
  const [advisors, setAdvisors] = useState<CatalogAdvisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<CatalogPerson | null>(null);
  const [personDraft, setPersonDraft] = useState<{ orderNo: string; roleLabel: string; bioShort: string; eduOverride: string; certOverride: string; photoAssetId: string | null }>({
    orderNo: "",
    roleLabel: "",
    bioShort: "",
    eduOverride: "",
    certOverride: "",
    photoAssetId: null,
  });
  // 임원진 카드에 지금 실리는 학력·자격·경력(인사 기록 + 직접 고친 값) — 표에 보여 주고 편집 창 처음 값으로 쓴다
  const [leaderCards, setLeaderCards] = useState<Record<string, LeaderCardFields>>({});
  const [personInit, setPersonInit] = useState<{ edu: string; cert: string; career: string } | null>(null);
  const [advisorDraft, setAdvisorDraft] = useState<typeof emptyAdvisor | null>(null);
  // 직접 입력 임원(촉탁)
  const [extras, setExtras] = useState<CatalogExtraPerson[]>([]);
  const [extraDraft, setExtraDraft] = useState<typeof emptyExtra | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await catalogFetch<{ people: CatalogPerson[]; extraPeople: CatalogExtraPerson[]; advisors: CatalogAdvisor[]; leaderCards?: Record<string, LeaderCardFields> }>(
        "/api/catalog/people"
      );
      setPeople(data.people);
      setLeaderCards(data.leaderCards ?? {});
      setExtras(data.extraPeople ?? []);
      setAdvisors(data.advisors);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const execs = useMemo(() => people.filter((p) => p.section === "exec"), [people]);
  const staff = useMemo(() => people.filter((p) => p.section === "staff"), [people]);

  const patchPerson = async (employeeId: string, patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const data = await catalogFetch<{ people: CatalogPerson[]; leaderCards?: Record<string, LeaderCardFields> }>("/api/catalog/people", {
        method: "PUT",
        body: JSON.stringify({ employeeId, patch }),
      });
      setPeople(data.people);
      if (data.leaderCards) setLeaderCards(data.leaderCards);
      return true;
    } catch (e) {
      alert((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveAdvisor = async () => {
    if (!advisorDraft) return;
    setBusy(true);
    try {
      const data = await catalogFetch<{ advisors: CatalogAdvisor[] }>("/api/catalog/advisors", {
        method: "POST",
        body: JSON.stringify(advisorDraft),
      });
      setAdvisors(data.advisors);
      setAdvisorDraft(null);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeAdvisor = async (a: CatalogAdvisor) => {
    if (!confirm(`자문위원 '${a.name}'을(를) 삭제할까요?`)) return;
    setBusy(true);
    try {
      const data = await catalogFetch<{ advisors: CatalogAdvisor[] }>(`/api/catalog/advisors?advisorId=${encodeURIComponent(a.advisorId)}`, { method: "DELETE" });
      setAdvisors(data.advisors);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveExtra = async () => {
    if (!extraDraft) return;
    setBusy(true);
    try {
      const data = await catalogFetch<{ extraPeople: CatalogExtraPerson[] }>("/api/catalog/extra-people", {
        method: "POST",
        body: JSON.stringify(extraDraft),
      });
      setExtras(data.extraPeople);
      setExtraDraft(null);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 직접 입력 임원 사진 게재 — 표의 선택 칸에서 바로 저장(사용자관리 임원의 사진 칸과 같은 방식)
  const patchExtraPhoto = async (x: CatalogExtraPerson, photoConsent: boolean | null) => {
    setBusy(true);
    try {
      const data = await catalogFetch<{ extraPeople: CatalogExtraPerson[] }>("/api/catalog/extra-people", {
        method: "POST",
        body: JSON.stringify({ ...x, photoConsent }),
      });
      setExtras(data.extraPeople);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeExtra = async (x: CatalogExtraPerson) => {
    if (!confirm(`'${x.name}'을(를) 임원 목록에서 삭제할까요?`)) return;
    setBusy(true);
    try {
      const data = await catalogFetch<{ extraPeople: CatalogExtraPerson[] }>(`/api/catalog/extra-people?personId=${encodeURIComponent(x.personId)}`, { method: "DELETE" });
      setExtras(data.extraPeople);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadExtraPhoto = async (file: File, photoTarget: "extra" | "person" = "extra") => {
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      fd.append("kind", "photo");
      fd.append("file", file);
      const data = await catalogFetch<{ asset: { assetId: string } }>("/api/catalog/assets", { method: "POST", body: fd });
      if (photoTarget === "person") setPersonDraft((d) => ({ ...d, photoAssetId: data.asset.assetId }));
      else setExtraDraft((d) => (d ? { ...d, photoAssetId: data.asset.assetId } : d));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPhotoUploading(false);
    }
  };

  const list = tab === "exec" ? execs : staff;
  const extraCounted = extras.filter((x) => x.countInTotal).length;

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Users className="w-5 h-5" />}
        eyebrow="회사소개서"
        breadcrumbs={[{ label: "회사소개서", href: "/sales/catalog" }, { label: "인물 노출 관리" }]}
        title="인물 노출 관리"
        helpTopic="catalog.people"
        meta={
          <span className="text-xs cd-text-muted">
            임원진 {execs.filter((p) => p.shown).length + extras.filter((x) => x.isPublic).length}명(촉탁 {extras.filter((x) => x.isPublic).length}) · 기술인력{" "}
            {staff.filter((p) => p.shown).length}명 · 자문위원 {advisors.filter((a) => a.isPublic).length}명 게재 · 인원 집계 임원 {execs.length + extraCounted}·직원 {staff.length}
          </span>
        }
        actions={
          <>
            <CatalogBackLink />
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={reload} disabled={loading || busy}>
              <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
            </button>
          </>
        }
        tabs={
          <CdTabs<TabKey>
            items={[
              { key: "exec", label: "임원진", count: execs.length + extras.length },
              { key: "staff", label: "기술인력", count: staff.length },
              { key: "advisors", label: "자문위원", count: advisors.length },
            ]}
            active={tab}
            onChange={setTab}
          />
        }
      />

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}

      {tab !== "advisors" ? (
        <section className="cd-card p-4">
          <div className="text-xs cd-text-muted mb-3 flex items-center gap-1">
            {tab === "exec"
              ? "사용자관리에 등록된 재직자 중 직급이 부장보다 높은 사람이 자동으로 들어옵니다. 사진은 거부하지 않으면 싣습니다. 기술인력 명단·인원은 등급 칸에서 정합니다."
              : "부장 이하 직급의 재직자입니다. 대행업·엔지니어링 등급이 있으면 자동으로 싣고, 사진은 동의한 사람만 싣습니다. 기술인력 명단·인원은 등급 칸에서 정합니다."}
            <CdHelp topic="catalog.people-rules" />
          </div>
          {loading ? (
            <p className="text-sm cd-text-faint py-6 text-center">불러오는 중…</p>
          ) : list.length === 0 ? (
            <p className="text-sm cd-text-faint py-6 text-center">해당하는 재직자가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="cd-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>부서·직위</th>
                    <th>등급</th>
                    <th>입사일</th>
                    <th>구획</th>
                    <th>게재</th>
                    <th>사진</th>
                    <th>소개서 직함·약력</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.employeeId}>
                      <td className="cd-text font-semibold whitespace-nowrap">
                        {p.meta?.orderNo != null && <span className="cd-text-faint tabular-nums mr-1">{p.meta.orderNo}.</span>}
                        {p.name}
                      </td>
                      <td className="cd-text-muted whitespace-nowrap">{[p.deptName, p.positionName].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="cd-text-muted whitespace-nowrap">
                        <div>{[p.envGrade && `대행업 ${p.envGrade}`, p.engGrade && `엔지니어링 ${p.engGrade}`].filter(Boolean).join(" · ") || "—"}</div>
                        {/* 기술인력 명단·인원(356) — 자동은 대행업 고급·일반 등급, 구획과 무관(사용자 지시 2026-11-12) */}
                        <div className="flex items-center gap-1 mt-1">
                          <select
                            className="cd-select"
                            style={{ width: 168 }}
                            value={p.meta?.techOverride == null ? "" : p.meta.techOverride ? "1" : "0"}
                            disabled={busy}
                            onChange={(e) => patchPerson(p.employeeId, { techOverride: e.target.value === "" ? null : e.target.value === "1" })}
                            aria-label={`${p.name} 기술인력 명단`}
                          >
                            <option value="">자동({!p.isTechnicalByGrade ? "기술인력 아님" : p.section === "exec" ? "임원진·인원만" : "명단"})</option>
                            <option value="1">명단에 넣기</option>
                            <option value="0">기술인력 빼기</option>
                          </select>
                          <span className={`cd-pill ${p.isTechnical ? "cd-pill-info" : "cd-pill-idle"}`}>
                            {p.inTechList ? "명단" : p.isTechnical ? "인원만" : "명단 밖"}
                          </span>
                        </div>
                      </td>
                      <td className="tabular-nums whitespace-nowrap">{p.hiredAt.slice(0, 10) || "—"}</td>
                      <td>
                        <select
                          className="cd-select"
                          style={{ width: 112 }}
                          value={p.meta?.sectionOverride ?? ""}
                          disabled={busy}
                          onChange={(e) => patchPerson(p.employeeId, { sectionOverride: e.target.value || null })}
                          aria-label={`${p.name} 구획`}
                        >
                          <option value="">자동({p.isExecByRule ? "임원진" : "기술인력"})</option>
                          <option value="exec">임원진</option>
                          <option value="staff">기술인력</option>
                        </select>
                      </td>
                      <td className="whitespace-nowrap">
                        <select
                          className="cd-select"
                          style={{ width: 100 }}
                          value={p.meta?.displayOverride ?? "auto"}
                          disabled={busy}
                          onChange={(e) => patchPerson(p.employeeId, { displayOverride: e.target.value as DisplayOverride })}
                          aria-label={`${p.name} 게재`}
                        >
                          <option value="auto">자동</option>
                          <option value="always">항상 싣기</option>
                          <option value="never">빼기</option>
                        </select>
                        <span className={`cd-pill ml-1 ${p.shown ? "cd-pill-info" : "cd-pill-idle"}`}>{p.shown ? "게재" : "제외"}</span>
                      </td>
                      <td className="whitespace-nowrap">
                        <select
                          className="cd-select"
                          style={{ width: 96 }}
                          value={p.meta?.photoConsent == null ? "" : p.meta.photoConsent ? "1" : "0"}
                          disabled={busy}
                          onChange={(e) => patchPerson(p.employeeId, { photoConsent: e.target.value === "" ? null : e.target.value === "1" })}
                          aria-label={`${p.name} 사진 게재 동의`}
                        >
                          <option value="">미확인</option>
                          <option value="1">동의</option>
                          <option value="0">거부</option>
                        </select>
                        <span className={`cd-pill ml-1 ${p.photoShown ? "cd-pill-info" : "cd-pill-idle"}`}>
                          {!p.hasPhoto ? "사진 없음" : p.photoShown ? "싣기" : "안 실음"}
                        </span>
                        {photoSrc(p) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoSrc(p)!} alt={`${p.name} 사진`} className="inline-block ml-1 w-7 h-9 object-cover rounded border cd-border-c align-middle" />
                        )}
                      </td>
                      <td className="cd-text-muted text-xs" style={{ maxWidth: 280 }}>
                        {p.meta?.roleLabel && <span className="block cd-text">{p.meta.roleLabel}</span>}
                        {p.section === "exec" && leaderCards[p.employeeId] ? (
                          <>
                            <span className="block truncate">학력 {leaderCards[p.employeeId].edu || "—"}</span>
                            <span className="block truncate">자격 {leaderCards[p.employeeId].cert || "—"}</span>
                            <span className="block truncate">경력 {leaderCards[p.employeeId].career || "—"}</span>
                          </>
                        ) : (
                          <span className="block truncate">{p.meta?.bioShort || "—"}</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="cd-btn cd-btn-ghost cd-btn-sm"
                          aria-label={`${p.name} 직함·약력 편집`}
                          onClick={() => {
                            setEditing(p);
                            // 임원은 지금 소개서에 실리는 학력·자격·경력 줄로 채워 연다(고치지 않은 칸은 그대로 둔다)
                            const lc = p.section === "exec" ? leaderCards[p.employeeId] : undefined;
                            setPersonInit(lc ? { edu: lc.edu, cert: lc.cert, career: lc.career } : null);
                            setPersonDraft({
                              orderNo: p.meta?.orderNo != null ? String(p.meta.orderNo) : "",
                              roleLabel: p.meta?.roleLabel ?? "",
                              bioShort: lc ? lc.career : p.meta?.bioShort ?? "",
                              eduOverride: lc ? lc.edu : p.meta?.eduOverride ?? "",
                              certOverride: lc ? lc.cert : p.meta?.certOverride ?? "",
                              photoAssetId: p.meta?.photoAssetId ?? null,
                            });
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "exec" && (
            <div className="mt-5">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="cd-text font-semibold text-sm flex items-center gap-1">
                  직접 입력한 임원(촉탁) <CdHelp topic="catalog.extra-people" />
                </h3>
                <span className="text-xs cd-text-faint">고문 등 근로계약 없이 자문 계약을 맺어 사용자관리에 없는 임원</span>
                <button
                  type="button"
                  className="cd-btn cd-btn-primary cd-btn-sm ml-auto shrink-0"
                  disabled={busy}
                  onClick={() => setExtraDraft({ ...emptyExtra, orderNo: execs.length + extras.length + 1 })}
                >
                  <Plus className="w-3.5 h-3.5" /> 임원 직접 추가
                </button>
              </div>
              {extras.length === 0 ? (
                <p className="text-sm cd-text-faint py-4 text-center rounded-lg border cd-border-c">직접 입력한 임원이 없습니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="cd-table">
                    <thead>
                      <tr>
                        <th>사진</th>
                        <th>이름</th>
                        <th>직함·구분</th>
                        <th>약력 요약</th>
                        <th className="text-right">순서</th>
                        <th>게재·집계</th>
                        <th style={{ width: 80 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {extras.map((x) => (
                        <tr key={x.personId}>
                          <td className="whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {x.photoAssetId ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={`/api/catalog/assets/${encodeURIComponent(x.photoAssetId)}`} alt={`${x.name} 사진`} className="w-10 h-12 object-cover rounded border cd-border-c" />
                              ) : (
                                <span className="text-xs cd-text-faint">없음</span>
                              )}
                              <select
                                className="cd-select"
                                style={{ width: 96 }}
                                value={x.photoConsent == null ? "" : x.photoConsent ? "1" : "0"}
                                disabled={busy}
                                onChange={(e) => patchExtraPhoto(x, e.target.value === "" ? null : e.target.value === "1")}
                                aria-label={`${x.name} 사진 게재 동의`}
                              >
                                <option value="">미확인</option>
                                <option value="1">동의</option>
                                <option value="0">거부</option>
                              </select>
                              <span className={`cd-pill ${x.photoAssetId && x.photoConsent !== false ? "cd-pill-info" : "cd-pill-idle"}`}>
                                {!x.photoAssetId ? "사진 없음" : x.photoConsent !== false ? "싣기" : "안 실음"}
                              </span>
                            </div>
                          </td>
                          <td className="cd-text font-semibold whitespace-nowrap">{x.name}</td>
                          <td className="cd-text-muted whitespace-nowrap">
                            {x.roleLabel || "—"}
                            <span className="cd-pill cd-pill-idle ml-1">{x.employmentType} · 직접 입력</span>
                          </td>
                          <td className="cd-text-muted text-xs" style={{ maxWidth: 320 }}>
                            <span className="block truncate">{x.bioShort.split("\n")[0] || "—"}</span>
                          </td>
                          <td className="text-right tabular-nums">{x.orderNo ?? "—"}</td>
                          <td className="whitespace-nowrap">
                            <span className={`cd-pill ${x.isPublic ? "cd-pill-info" : "cd-pill-idle"}`}>{x.isPublic ? "게재" : "제외"}</span>
                            <span className={`cd-pill ml-1 ${x.countInTotal ? "cd-pill-info" : "cd-pill-idle"}`}>{x.countInTotal ? "인원 포함" : "인원 제외"}</span>
                          </td>
                          <td className="whitespace-nowrap">
                            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${x.name} 편집`} onClick={() => setExtraDraft({ ...x })}>
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${x.name} 삭제`} disabled={busy} onClick={() => removeExtra(x)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="cd-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-xs cd-text-muted">외부 자문위원 명부입니다. 공개로 둔 사람만 소개서에 실립니다.</p>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm ml-auto" onClick={() => setAdvisorDraft({ ...emptyAdvisor, orderNo: advisors.length + 1 })}>
              <Plus className="w-3.5 h-3.5" /> 자문위원 추가
            </button>
          </div>
          {loading ? (
            <p className="text-sm cd-text-faint py-6 text-center">불러오는 중…</p>
          ) : advisors.length === 0 ? (
            <p className="text-sm cd-text-faint py-6 text-center">등록된 자문위원이 없습니다. [자문위원 추가]로 명부를 만드세요.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="cd-table">
                <thead>
                  <tr>
                    <th className="text-right" style={{ width: 56 }}>순서</th>
                    <th>이름</th>
                    <th>분야</th>
                    <th>소속·직위</th>
                    <th>주요 경력</th>
                    <th>공개</th>
                    <th style={{ width: 80 }} />
                  </tr>
                </thead>
                <tbody>
                  {advisors.map((a) => (
                    <tr key={a.advisorId}>
                      <td className="text-right tabular-nums">{a.orderNo}</td>
                      <td className="cd-text font-semibold whitespace-nowrap">{a.name}</td>
                      <td className="cd-text-muted">{a.field || "—"}</td>
                      <td className="cd-text-muted">{[a.org, a.title].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="cd-text-muted text-xs" style={{ maxWidth: 320 }}>
                        <span className="block truncate">{a.career.split("\n")[0] || "—"}</span>
                      </td>
                      <td>
                        <span className={`cd-pill ${a.isPublic ? "cd-pill-info" : "cd-pill-idle"}`}>{a.isPublic ? "공개" : "비공개"}</span>
                      </td>
                      <td className="whitespace-nowrap">
                        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${a.name} 편집`} onClick={() => setAdvisorDraft({ ...a })}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${a.name} 삭제`} disabled={busy} onClick={() => removeAdvisor(a)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <CdModal
        open={!!editing}
        onClose={() => (busy ? undefined : setEditing(null))}
        title={editing ? `${editing.name} — 소개서 사진·직함·약력` : ""}
        size="md"
        closeOnBackdrop={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="cd-btn cd-btn-ghost" disabled={busy} onClick={() => setEditing(null)}>취소</button>
            <button
              type="button"
              className="cd-btn cd-btn-primary"
              disabled={busy || photoUploading}
              onClick={async () => {
                if (!editing) return;
                const lc = editing.section === "exec" ? leaderCards[editing.employeeId] : undefined;
                // 임원 칸: 처음 값 그대로면 건드리지 않고, 인사 기록 값과 같게 고치거나 비우면 직접 입력을 지운다(인사 기록을 따라감)
                const pick = (draft: string, init: string | undefined, auto: string | undefined) => {
                  const v = draft.trim();
                  if (init != null && v === init.trim()) return undefined;
                  return auto != null && v === auto.trim() ? "" : v;
                };
                const edu = lc ? pick(personDraft.eduOverride, personInit?.edu, lc.eduAuto) : undefined;
                const cert = lc ? pick(personDraft.certOverride, personInit?.cert, lc.certAuto) : undefined;
                const bio = lc ? pick(personDraft.bioShort, personInit?.career, lc.careerAuto) : personDraft.bioShort;
                const ok = await patchPerson(editing.employeeId, {
                  orderNo: personDraft.orderNo.trim() === "" ? null : Number(personDraft.orderNo),
                  roleLabel: personDraft.roleLabel,
                  ...(bio !== undefined ? { bioShort: bio } : {}),
                  ...(edu !== undefined ? { eduOverride: edu } : {}),
                  ...(cert !== undefined ? { certOverride: cert } : {}),
                  photoAssetId: personDraft.photoAssetId,
                });
                if (ok) setEditing(null);
              }}
            >
              저장
            </button>
          </div>
        }
      >
        <div className="grid gap-3 text-sm">
          {editing && (
            <div className="flex items-start gap-3">
              {personDraft.photoAssetId || editing.photoPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={personDraft.photoAssetId ? `/api/catalog/assets/${encodeURIComponent(personDraft.photoAssetId)}` : editing.photoPath!}
                  alt={`${editing.name} 사진`}
                  className="w-20 h-28 object-cover rounded border cd-border-c shrink-0"
                />
              ) : (
                <div className="w-20 h-28 rounded border cd-border-c flex items-center justify-center text-xs cd-text-faint shrink-0">사진 없음</div>
              )}
              <div className="grid gap-2">
                <p className="text-xs cd-text-muted">
                  {personDraft.photoAssetId ? "소개서 전용 사진을 씁니다." : editing.photoPath ? "인사 사진을 씁니다. 소개서용 사진을 따로 올릴 수 있습니다." : "사진이 없으면 소개서에는 이름 첫 글자 자리가 들어갑니다."}
                </p>
                <div className="flex items-center gap-2">
                  <label className={`cd-btn cd-btn-soft cd-btn-sm cd-action cursor-pointer ${photoUploading ? "opacity-50 pointer-events-none" : ""}`} title="PNG·JPG·WebP, 10MB 이하">
                    <ImageUp className="w-3.5 h-3.5" /> {photoUploading ? "올리는 중" : personDraft.photoAssetId ? "사진 바꾸기" : "소개서 사진 올리기"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".png,.jpg,.jpeg,.webp"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadExtraPhoto(f, "person");
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {personDraft.photoAssetId && (
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setPersonDraft({ ...personDraft, photoAssetId: null })}>
                      소개서 사진 빼기
                    </button>
                  )}
                </div>
                <p className="text-[11px] cd-text-faint">사진을 아예 싣지 않으려면 표의 사진 칸을 '거부'로 바꿉니다.</p>
              </div>
            </div>
          )}
          <label className="grid gap-1">
            <span className="text-xs cd-text-muted">순서(작은 수가 앞, 비우면 직급순)</span>
            <input className="cd-input tabular-nums" style={{ width: 96 }} inputMode="numeric" value={personDraft.orderNo} onChange={(e) => setPersonDraft({ ...personDraft, orderNo: e.target.value.replace(/[^\d]/g, "") })} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs cd-text-muted">소개서 직함(비우면 인사 직위)</span>
            <input className="cd-input" value={personDraft.roleLabel} placeholder={editing?.positionName || "예: 대표이사 / 기술연구소장"} onChange={(e) => setPersonDraft({ ...personDraft, roleLabel: e.target.value })} />
          </label>
          {editing?.section === "exec" ? (
            <>
              <p className="text-xs cd-text-faint">아래 세 칸은 회사소개서 임원진 카드의 학력·자격·경력 줄에 그대로 실립니다. 비우면 인사 기록(학력·자격증·경력)으로 채웁니다.</p>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">학력</span>
                <input className="cd-input" value={personDraft.eduOverride} placeholder={leaderCards[editing.employeeId]?.eduAuto || "예: 강원대학교 환경공학 박사"} onChange={(e) => setPersonDraft({ ...personDraft, eduOverride: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">자격(쉼표로 구분)</span>
                <input className="cd-input" value={personDraft.certOverride} placeholder={leaderCards[editing.employeeId]?.certAuto || "예: 대기관리기술사, 수질환경기사"} onChange={(e) => setPersonDraft({ ...personDraft, certOverride: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">경력(맨 앞 'N년'이 경력 연수 — 임원 평균 경력에 셉니다)</span>
                <textarea className="cd-input" rows={4} value={personDraft.bioShort} placeholder={leaderCards[editing.employeeId]?.careerAuto || "예: 37년 · 前 환경부 대기환경과장"} onChange={(e) => setPersonDraft({ ...personDraft, bioShort: e.target.value })} />
              </label>
            </>
          ) : (
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">약력 요약(3~4줄, 줄바꿈으로 구분)</span>
              <textarea className="cd-input" rows={4} value={personDraft.bioShort} onChange={(e) => setPersonDraft({ ...personDraft, bioShort: e.target.value })} />
            </label>
          )}
        </div>
      </CdModal>

      <CdModal
        open={!!extraDraft}
        onClose={() => (busy ? undefined : setExtraDraft(null))}
        title={<span className="inline-flex items-center gap-1">{extraDraft?.personId ? "직접 입력 임원 편집" : "임원 직접 추가"}<CdHelp topic="catalog.extra-person-form" /></span>}
        size="md"
        closeOnBackdrop={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="cd-btn cd-btn-ghost" disabled={busy} onClick={() => setExtraDraft(null)}>취소</button>
            <button type="button" className="cd-btn cd-btn-primary" disabled={busy || photoUploading || !extraDraft?.name.trim()} onClick={saveExtra}>저장</button>
          </div>
        }
      >
        {extraDraft && (
          <div className="grid gap-3 text-sm">
            <div className="flex gap-3">
              <div className="shrink-0 flex flex-col items-center gap-2" style={{ width: 96 }}>
                {extraDraft.photoAssetId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/catalog/assets/${encodeURIComponent(extraDraft.photoAssetId)}`} alt="임원 사진" className="w-24 h-32 object-cover rounded border cd-border-c" />
                ) : (
                  <div className="w-24 h-32 rounded border cd-border-c flex items-center justify-center text-xs cd-text-faint">사진 없음</div>
                )}
                <label className={`cd-btn cd-btn-soft cd-btn-sm cd-action cursor-pointer ${photoUploading ? "opacity-50 pointer-events-none" : ""}`}>
                  <ImageUp className="w-3.5 h-3.5" /> {photoUploading ? "올리는 중" : "사진 올리기"}
                  <input
                    type="file"
                    className="hidden"
                    accept=".png,.jpg,.jpeg,.webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadExtraPhoto(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {extraDraft.photoAssetId && (
                  <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setExtraDraft({ ...extraDraft, photoAssetId: null })}>사진 빼기</button>
                )}
              </div>
              <div className="grid gap-3 flex-1 min-w-0">
                <label className="grid gap-1">
                  <span className="text-xs cd-text-muted">이름 *</span>
                  <input className="cd-input" value={extraDraft.name} onChange={(e) => setExtraDraft({ ...extraDraft, name: e.target.value })} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1">
                    <span className="text-xs cd-text-muted">소개서 직함</span>
                    <input className="cd-input" value={extraDraft.roleLabel} placeholder="예: 고문" onChange={(e) => setExtraDraft({ ...extraDraft, roleLabel: e.target.value })} />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs cd-text-muted">계약 구분</span>
                    <select className="cd-select" value={extraDraft.employmentType} onChange={(e) => setExtraDraft({ ...extraDraft, employmentType: e.target.value as CatalogExtraPerson["employmentType"] })}>
                      {EXTRA_EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">학력</span>
                <input className="cd-input" value={extraDraft.edu} placeholder="예: 강원대학교 환경공학 박사" onChange={(e) => setExtraDraft({ ...extraDraft, edu: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">자격(쉼표로 구분)</span>
                <input className="cd-input" value={extraDraft.cert} placeholder="예: 수질환경기사, 행정사" onChange={(e) => setExtraDraft({ ...extraDraft, cert: e.target.value })} />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">약력 요약(3~4줄, 줄바꿈으로 구분 · 맨 앞에 'N년'을 적으면 임원 평균 경력에 셉니다)</span>
              <textarea className="cd-input" rows={4} value={extraDraft.bioShort} onChange={(e) => setExtraDraft({ ...extraDraft, bioShort: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">상세 경력(이력 쪽용, 선택)</span>
              <textarea className="cd-input" rows={3} value={extraDraft.career} onChange={(e) => setExtraDraft({ ...extraDraft, career: e.target.value })} />
            </label>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="inline-flex items-center gap-2">
                순서
                <input
                  className="cd-input tabular-nums"
                  style={{ width: 72 }}
                  inputMode="numeric"
                  value={extraDraft.orderNo ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, "");
                    setExtraDraft({ ...extraDraft, orderNo: v === "" ? null : Number(v) });
                  }}
                />
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={extraDraft.isPublic} onChange={(e) => setExtraDraft({ ...extraDraft, isPublic: e.target.checked })} /> 소개서에 싣기
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={extraDraft.countInTotal} onChange={(e) => setExtraDraft({ ...extraDraft, countInTotal: e.target.checked })} /> 임원 인원 수에 포함
              </label>
            </div>
          </div>
        )}
      </CdModal>

      <CdModal
        open={!!advisorDraft}
        onClose={() => (busy ? undefined : setAdvisorDraft(null))}
        title={advisorDraft?.advisorId ? "자문위원 편집" : "자문위원 추가"}
        size="md"
        closeOnBackdrop={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="cd-btn cd-btn-ghost" disabled={busy} onClick={() => setAdvisorDraft(null)}>취소</button>
            <button type="button" className="cd-btn cd-btn-primary" disabled={busy || !advisorDraft?.name.trim()} onClick={saveAdvisor}>저장</button>
          </div>
        }
      >
        {advisorDraft && (
          <div className="grid gap-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">이름 *</span>
                <input className="cd-input" value={advisorDraft.name} onChange={(e) => setAdvisorDraft({ ...advisorDraft, name: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">자문 분야</span>
                <input className="cd-input" value={advisorDraft.field} placeholder="예: 대기 / 화학안전 / ESG" onChange={(e) => setAdvisorDraft({ ...advisorDraft, field: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">소속</span>
                <input className="cd-input" value={advisorDraft.org} onChange={(e) => setAdvisorDraft({ ...advisorDraft, org: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">직위</span>
                <input className="cd-input" value={advisorDraft.title} onChange={(e) => setAdvisorDraft({ ...advisorDraft, title: e.target.value })} />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">주요 경력(줄바꿈으로 구분)</span>
              <textarea className="cd-input" rows={4} value={advisorDraft.career} onChange={(e) => setAdvisorDraft({ ...advisorDraft, career: e.target.value })} />
            </label>
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2">
                순서
                <input className="cd-input tabular-nums" style={{ width: 72 }} inputMode="numeric" value={advisorDraft.orderNo} onChange={(e) => setAdvisorDraft({ ...advisorDraft, orderNo: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} />
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={advisorDraft.isPublic} onChange={(e) => setAdvisorDraft({ ...advisorDraft, isPublic: e.target.checked })} /> 소개서에 공개
              </label>
            </div>
          </div>
        )}
      </CdModal>
    </div>
  );
}
