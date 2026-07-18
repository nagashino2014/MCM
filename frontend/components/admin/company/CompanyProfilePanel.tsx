"use client";

// 회사 프로필 관리 — 자사 일반현황·인적구성(env_grade 집계)·연혁 타임라인·주요 사업내용·
// 면허/인증 보유현황(LLM 파싱 자동입력). 입찰 증빙서류 패키지의 자사 데이터 공급원.
// docs/bid-package-blueprint.md §4-3

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  FileText,
  History,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Trash2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

interface FinanceRow {
  year: string;
  capital: string;
  revenue: string;
}

interface Profile {
  companyName: string;
  ceoName: string;
  bizRegNo: string;
  corpRegNo: string;
  address: string;
  phone: string;
  fax: string;
  bizField: string;
  foundedYm: string;
  mainBusiness: string;
  credit: { bondGrade: string; creditGrade: string; ratedAt: string };
  finance: FinanceRow[];
  updatedAt: string | null;
}

interface StaffComposition {
  total: number;
  rows: { grade: string; count: number }[];
}

interface HistoryItem {
  historyId: string;
  eventYm: string;
  content: string;
}

interface Credential {
  credentialId: string;
  kind: "license" | "certification";
  name: string;
  credentialNo: string;
  issuedAt: string;
  validUntil: string;
  issuer: string;
  note: string;
}

// 면허/인증 명칭 선택지 — 직접 입력도 가능(datalist)
const LICENSE_PRESETS = ["환경컨설팅회사", "엔지니어링 컨설팅업", "통합허가 대행업", "환경전문공사업", "기업부설연구소"];
const CERT_PRESETS = ["이노비즈(기술혁신형 중소기업)", "벤처기업 확인", "ISO 9001", "ISO 14001", "특허", "메인비즈"];

const emptyCredentialDraft = {
  credentialId: null as string | null,
  kind: "license" as "license" | "certification",
  name: "",
  credentialNo: "",
  issuedAt: "",
  validUntil: "",
  issuer: "",
  note: "",
};

async function jfetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? "요청 실패");
  return data;
}

export function CompanyProfilePanel() {
  const { theme } = useCdashTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [staff, setStaff] = useState<StaffComposition | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // 연혁 입력
  const [histYm, setHistYm] = useState("");
  const [histContent, setHistContent] = useState("");
  const [histEditing, setHistEditing] = useState<string | null>(null);
  const [histBusy, setHistBusy] = useState(false);

  // 면허/인증 입력
  const [credDraft, setCredDraft] = useState({ ...emptyCredentialDraft });
  const [credBusy, setCredBusy] = useState(false);
  const [parsing, setParsing] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await jfetch("/api/admin/company-profile")) as {
        profile: Profile;
        staff: StaffComposition;
        history: HistoryItem[];
        credentials: Credential[];
      };
      setProfile(data.profile);
      setStaff(data.staff);
      setHistory(data.history ?? []);
      setCredentials(data.credentials ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const set = (patch: Partial<Profile>) => setProfile((prev) => (prev ? { ...prev, ...patch } : prev));

  const saveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    try {
      const data = (await jfetch("/api/admin/company-profile", { method: "PUT", body: JSON.stringify(profile) })) as { profile: Profile };
      setProfile(data.profile);
      setSavedAt(new Date().toLocaleTimeString("ko-KR"));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSavingProfile(false);
    }
  };

  const submitHistory = async () => {
    setHistBusy(true);
    try {
      if (histEditing) {
        const data = (await jfetch("/api/admin/company-profile/history", {
          method: "PUT",
          body: JSON.stringify({ historyId: histEditing, eventYm: histYm, content: histContent }),
        })) as { history: HistoryItem[] };
        setHistory(data.history);
      } else {
        const data = (await jfetch("/api/admin/company-profile/history", {
          method: "POST",
          body: JSON.stringify({ eventYm: histYm, content: histContent }),
        })) as { history: HistoryItem[] };
        setHistory(data.history);
      }
      setHistYm("");
      setHistContent("");
      setHistEditing(null);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setHistBusy(false);
    }
  };

  const removeHistory = async (historyId: string) => {
    if (!confirm("이 연혁 항목을 삭제할까요?")) return;
    try {
      const data = (await jfetch(`/api/admin/company-profile/history?historyId=${encodeURIComponent(historyId)}`, { method: "DELETE" })) as { history: HistoryItem[] };
      setHistory(data.history);
      if (histEditing === historyId) {
        setHistEditing(null);
        setHistYm("");
        setHistContent("");
      }
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const submitCredential = async () => {
    setCredBusy(true);
    try {
      const data = (await jfetch("/api/admin/company-profile/credentials", {
        method: "POST",
        body: JSON.stringify(credDraft),
      })) as { credentials: Credential[] };
      setCredentials(data.credentials);
      setCredDraft({ ...emptyCredentialDraft });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCredBusy(false);
    }
  };

  const removeCredential = async (credentialId: string) => {
    if (!confirm("이 면허/인증 항목을 삭제할까요?")) return;
    try {
      const data = (await jfetch(`/api/admin/company-profile/credentials?credentialId=${encodeURIComponent(credentialId)}`, { method: "DELETE" })) as { credentials: Credential[] };
      setCredentials(data.credentials);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // 면허/인증 문서 업로드 → LLM 분석 → 입력 폼 프리필
  const parseCredentialFile = async (file: File) => {
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = (await jfetch("/api/admin/company-profile/credentials/parse", { method: "POST", body: fd })) as {
        fields: { kind: "license" | "certification"; name: string; credentialNo: string; issuedAt: string; validUntil: string; issuer: string };
      };
      setCredDraft((prev) => ({
        ...prev,
        credentialId: null,
        kind: data.fields.kind,
        name: data.fields.name || prev.name,
        credentialNo: data.fields.credentialNo,
        issuedAt: data.fields.issuedAt,
        validUntil: data.fields.validUntil,
        issuer: data.fields.issuer,
      }));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Building2 className="w-5 h-5" />}
        eyebrow="System · Company"
        title="회사 프로필 관리"
        subtitle="자사 일반현황·연혁·면허/인증 보유현황을 관리합니다. 입찰 증빙서류 패키지 생성 시 이 데이터가 사용됩니다."
        actions={
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-[11px] cd-text-faint">저장됨 {savedAt}</span>}
            <button
              type="button"
              onClick={saveProfile}
              disabled={savingProfile || !profile}
              className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              {savingProfile ? "저장 중..." : "일반현황 저장"}
            </button>
          </div>
        }
      />

      {loading ? (
        <div className="cd-card rounded-3xl p-8 text-center text-sm cd-text-faint">불러오는 중입니다.</div>
      ) : error ? (
        <div className="cd-card rounded-3xl p-8 text-center text-sm cd-text-faint">{error}</div>
      ) : profile ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-hide pb-2">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* 업체 일반현황 */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-1 xl:col-span-2">
              <h3 className="font-bold cd-text flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 cd-text-primary" /> 업체 일반현황
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <L label="업체명"><input className="cd-input" value={profile.companyName} onChange={(e) => set({ companyName: e.target.value })} /></L>
                <L label="대표자"><input className="cd-input" value={profile.ceoName} onChange={(e) => set({ ceoName: e.target.value })} /></L>
                <L label="사업자번호"><input className="cd-input" value={profile.bizRegNo} onChange={(e) => set({ bizRegNo: e.target.value })} placeholder="000-00-00000" /></L>
                <L label="법인등록번호"><input className="cd-input" value={profile.corpRegNo} onChange={(e) => set({ corpRegNo: e.target.value })} /></L>
                <L label="업종(사업분야)"><input className="cd-input" value={profile.bizField} onChange={(e) => set({ bizField: e.target.value })} placeholder="환경컨설팅, 환경공학 연구개발업" /></L>
                <L label="설립년월"><input className="cd-input" value={profile.foundedYm} onChange={(e) => set({ foundedYm: e.target.value })} placeholder="2016-02" /></L>
                <L label="전화번호"><input className="cd-input" value={profile.phone} onChange={(e) => set({ phone: e.target.value })} /></L>
                <L label="팩스"><input className="cd-input" value={profile.fax} onChange={(e) => set({ fax: e.target.value })} /></L>
                <div className="md:col-span-3">
                  <L label="주소"><input className="cd-input" value={profile.address} onChange={(e) => set({ address: e.target.value })} /></L>
                </div>
              </div>

              <h4 className="text-[12px] font-bold cd-text mt-4 mb-2">신용평가 등급</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <L label="회사채 등급"><input className="cd-input" value={profile.credit.bondGrade} onChange={(e) => set({ credit: { ...profile.credit, bondGrade: e.target.value } })} placeholder="BBB0" /></L>
                <L label="기업신용 등급"><input className="cd-input" value={profile.credit.creditGrade} onChange={(e) => set({ credit: { ...profile.credit, creditGrade: e.target.value } })} placeholder="BB+" /></L>
                <L label="평가일"><input className="cd-input" value={profile.credit.ratedAt} onChange={(e) => set({ credit: { ...profile.credit, ratedAt: e.target.value } })} placeholder="2026-01-15" /></L>
              </div>

              <h4 className="text-[12px] font-bold cd-text mt-4 mb-2">재정상황 (연도별, 단위 자유 표기)</h4>
              <div className="flex flex-col gap-2">
                {profile.finance.map((f, i) => (
                  <div key={i} className="grid grid-cols-[90px_1fr_1fr_32px] gap-2 text-xs items-center">
                    <input className="cd-input" value={f.year} placeholder="2025" onChange={(e) => set({ finance: profile.finance.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)) })} />
                    <input className="cd-input" value={f.capital} placeholder="자본금 (예: 1억 2천500만원)" onChange={(e) => set({ finance: profile.finance.map((x, j) => (j === i ? { ...x, capital: e.target.value } : x)) })} />
                    <input className="cd-input" value={f.revenue} placeholder="매출액 (예: 40억 7천만원)" onChange={(e) => set({ finance: profile.finance.map((x, j) => (j === i ? { ...x, revenue: e.target.value } : x)) })} />
                    <button type="button" className="cd-btn cd-btn-ghost rounded-lg p-1.5" onClick={() => set({ finance: profile.finance.filter((_, j) => j !== i) })}>
                      <Trash2 className="w-3.5 h-3.5 cd-text-faint" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="cd-btn cd-btn-soft rounded-lg px-3 py-1.5 text-xs self-start inline-flex items-center gap-1"
                  onClick={() => set({ finance: [...profile.finance, { year: "", capital: "", revenue: "" }] })}
                >
                  <Plus className="w-3.5 h-3.5" /> 연도 추가
                </button>
              </div>
            </section>

            {/* 인적구성 (자동 집계) */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-1 flex flex-col">
              <h3 className="font-bold cd-text flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 cd-text-primary" /> 인적구성
                <span className="ml-auto text-[11px] font-normal cd-text-faint">통합허가 대행업 기준</span>
              </h3>
              <p className="text-[11px] cd-text-faint mb-3">
                사용자 등록·삭제의 인원 상세 <b>환경부 등급(대행업)</b> 값으로 자동 집계됩니다(재직자 기준).
              </p>
              <div className="rounded-xl border cd-border-c divide-y cd-border-c">
                <div className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="cd-text font-semibold">계</span>
                  <span className="cd-text font-bold">{staff?.total ?? 0}명</span>
                </div>
                {(staff?.rows ?? []).map((r) => (
                  <div key={r.grade} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="cd-text">{r.grade}</span>
                    <span className="cd-text">{r.count}명</span>
                  </div>
                ))}
              </div>
              <Link href="/admin/users/registry" className="mt-3 text-[11px] cd-text-primary self-start">
                인원별 등급은 사용자 등록·삭제에서 관리 →
              </Link>

              <h4 className="text-[12px] font-bold cd-text mt-5 mb-2">주요 사업내용</h4>
              <textarea
                className="cd-input text-xs flex-1 min-h-[120px] resize-none"
                value={profile.mainBusiness}
                onChange={(e) => set({ mainBusiness: e.target.value })}
                placeholder="예: 통합환경허가 대행, 환경컨설팅, 대기·수질 측정 분석 …"
              />
              <p className="text-[10px] cd-text-faint mt-1">일반현황 저장 버튼으로 함께 저장됩니다.</p>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* 연혁 타임라인 */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 flex flex-col">
              <h3 className="font-bold cd-text flex items-center gap-2 mb-3">
                <History className="w-4 h-4 cd-text-primary" /> 주요 연혁
                <span className="ml-auto text-[11px] font-normal cd-text-faint">{history.length}건</span>
              </h3>
              <div className="flex gap-2 mb-3">
                <input className="cd-input text-xs w-[110px]" value={histYm} onChange={(e) => setHistYm(e.target.value)} placeholder="2025-01" />
                <input className="cd-input text-xs flex-1" value={histContent} onChange={(e) => setHistContent(e.target.value)} placeholder="예: 기술혁신형 중소기업(Inno-Biz) 인증" />
                <button type="button" onClick={submitHistory} disabled={histBusy} className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 shrink-0">
                  {histEditing ? "수정" : "추가"}
                </button>
                {histEditing && (
                  <button type="button" className="cd-btn cd-btn-ghost rounded-lg px-2 py-1.5 text-xs shrink-0" onClick={() => { setHistEditing(null); setHistYm(""); setHistContent(""); }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* 타임라인 — 영업 스케쥴 이력과 같은 세로선+노드 형태 */}
              <div className="relative pl-5 flex-1 min-h-[160px] max-h-[420px] overflow-y-auto scrollbar-hide">
                <div className="absolute left-[7px] top-1 bottom-1 w-px" style={{ background: "var(--cd-border)" }} />
                {history.length === 0 && <p className="text-xs cd-text-faint py-4">연혁을 추가하면 타임라인으로 표시됩니다.</p>}
                {history.map((h) => (
                  <div key={h.historyId} className="relative pb-4 group">
                    <span
                      className="absolute -left-5 top-1 w-[15px] h-[15px] rounded-full border-2 flex items-center justify-center"
                      style={{ borderColor: "var(--cd-primary)", background: "var(--cd-card)" }}
                    >
                      <span className="w-[5px] h-[5px] rounded-full" style={{ background: "var(--cd-primary)" }} />
                    </span>
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] font-mono font-bold cd-text-primary shrink-0 mt-0.5">{h.eventYm.replace("-", ". ")}.</span>
                      <span className="text-xs cd-text flex-1">{h.content}</span>
                      <span className="opacity-0 group-hover:opacity-100 flex gap-1 shrink-0">
                        <button type="button" className="cd-btn cd-btn-ghost rounded p-1" onClick={() => { setHistEditing(h.historyId); setHistYm(h.eventYm); setHistContent(h.content); }}>
                          <Pencil className="w-3 h-3 cd-text-faint" />
                        </button>
                        <button type="button" className="cd-btn cd-btn-ghost rounded p-1" onClick={() => removeHistory(h.historyId)}>
                          <Trash2 className="w-3 h-3 cd-text-faint" />
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 면허/인증 보유현황 */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 flex flex-col">
              <h3 className="font-bold cd-text flex items-center gap-2 mb-3">
                <BadgeCheck className="w-4 h-4 cd-text-primary" /> 면허 · 허가 · 등록증 및 인증 보유현황
                <span className="ml-auto text-[11px] font-normal cd-text-faint">{credentials.length}건</span>
              </h3>

              {/* 입력 폼 — 문서 업로드 LLM 분석으로 자동 채움 */}
              <div className="rounded-xl border cd-border-c p-3 mb-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div className="md:col-span-2 flex items-center gap-2">
                  <select className="cd-select w-[110px]" value={credDraft.kind} onChange={(e) => setCredDraft((p) => ({ ...p, kind: e.target.value as "license" | "certification" }))}>
                    <option value="license">면허/등록증</option>
                    <option value="certification">인증</option>
                  </select>
                  <input
                    className="cd-input flex-1"
                    list="credential-name-presets"
                    value={credDraft.name}
                    onChange={(e) => setCredDraft((p) => ({ ...p, name: e.target.value }))}
                    placeholder="명칭 선택 또는 직접 입력"
                  />
                  <datalist id="credential-name-presets">
                    {(credDraft.kind === "license" ? LICENSE_PRESETS : CERT_PRESETS).map((n) => <option key={n} value={n} />)}
                  </datalist>
                  <label className="cd-btn cd-btn-soft rounded-lg px-3 py-1.5 font-semibold cursor-pointer inline-flex items-center gap-1 shrink-0" title="면허/인증 문서(PDF·이미지)를 업로드하면 LLM 분석으로 명칭·번호·취득일·유효기간을 자동 입력합니다.">
                    <Wand2 className="w-3.5 h-3.5" />
                    {parsing ? "분석 중..." : "문서 분석"}
                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      disabled={parsing}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) parseCredentialFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <input className="cd-input" value={credDraft.credentialNo} onChange={(e) => setCredDraft((p) => ({ ...p, credentialNo: e.target.value }))} placeholder="번호 (예: 제 44호)" />
                <input className="cd-input" value={credDraft.issuer} onChange={(e) => setCredDraft((p) => ({ ...p, issuer: e.target.value }))} placeholder="발급기관" />
                <input className="cd-input" value={credDraft.issuedAt} onChange={(e) => setCredDraft((p) => ({ ...p, issuedAt: e.target.value }))} placeholder="취득일 (2021-08-05)" />
                <input className="cd-input" value={credDraft.validUntil} onChange={(e) => setCredDraft((p) => ({ ...p, validUntil: e.target.value }))} placeholder="유효기간 만료일 (없으면 비움)" />
                <div className="md:col-span-2 flex justify-end">
                  <button type="button" onClick={submitCredential} disabled={credBusy || !credDraft.name.trim()} className="cd-btn cd-btn-primary rounded-lg px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> {credDraft.credentialId ? "수정 저장" : "추가"}
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide rounded-xl border cd-border-c divide-y cd-border-c">
                {credentials.length === 0 && <p className="p-4 text-xs cd-text-faint">보유 면허/인증을 추가하세요.</p>}
                {credentials.map((c) => (
                  <div key={c.credentialId} className="px-3 py-2 text-xs flex items-center gap-2 group">
                    <span className={"text-[10px] rounded-full px-1.5 py-0.5 shrink-0 " + (c.kind === "license" ? "cd-tint-primary" : "border cd-border-c cd-text-faint")}>
                      {c.kind === "license" ? "면허" : "인증"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="cd-text font-semibold truncate">{c.name}{c.credentialNo ? ` (${c.credentialNo})` : ""}</p>
                      <p className="text-[10px] cd-text-faint truncate">
                        {[c.issuedAt && `취득 ${c.issuedAt}`, c.validUntil && `유효 ~${c.validUntil}`, c.issuer].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className="opacity-0 group-hover:opacity-100 flex gap-1 shrink-0">
                      <button type="button" className="cd-btn cd-btn-ghost rounded p-1" onClick={() => setCredDraft({ credentialId: c.credentialId, kind: c.kind, name: c.name, credentialNo: c.credentialNo, issuedAt: c.issuedAt, validUntil: c.validUntil, issuer: c.issuer, note: c.note })}>
                        <Pencil className="w-3 h-3 cd-text-faint" />
                      </button>
                      <button type="button" className="cd-btn cd-btn-ghost rounded p-1" onClick={() => removeCredential(c.credentialId)}>
                        <Trash2 className="w-3 h-3 cd-text-faint" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] cd-text-faint mt-2 flex items-center gap-1">
                <Paperclip className="w-3 h-3" /> 문서 분석은 사업자등록증 추출과 같은 Claude 멀티모달 파싱을 사용합니다.
              </p>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] cd-text-faint">{label}</span>
      {children}
    </label>
  );
}
