"use client";

// 회사 프로필 관리 — 자사 일반현황·인적구성(env_grade 집계)·연혁 타임라인·주요 사업내용·
// 면허/인증 보유현황(LLM 파싱 자동입력). 입찰 증빙서류 패키지의 자사 데이터 공급원.
// 재정상황=홈택스 표준재무제표 업로드 LLM 추출, 신용평가=등급서 업로드 LLM 추출.
// docs/bid-package-blueprint.md §4-3

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  Eye,
  EyeOff,
  FileText,
  History,
  Paperclip,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import "@/components/cdash/cdash.css";

interface FinanceRow {
  year: string;
  capital: string;
  totalAssets: string;
  totalLiabilities: string;
  equity: string;
  revenue: string;
  operatingProfit: string;
}

interface CreditRow {
  agency: string;
  ratingType: string;
  creditGrade: string;
  ratedAt: string;
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
  website: string;
  email: string;
  credit: CreditRow[];
  creditImage: { storageKey: string; fileName: string } | null;
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
  category: string;
  /** 면허·인증에서 자동으로 만든 줄 — 연월·내용은 원본에서 고친다 */
  sourceTable: string | null;
  isPublic: boolean;
  highlight: boolean;
}

type CredentialKind = "license" | "certification" | "patent" | "award";

interface Credential {
  credentialId: string;
  kind: CredentialKind;
  name: string;
  credentialNo: string;
  issuedAt: string;
  validUntil: string;
  issuer: string;
  note: string;
  isPublic: boolean;
  file: { storageKey: string; fileName: string } | null;
}

const CREDENTIAL_KIND_LABEL: Record<CredentialKind, string> = { license: "면허", certification: "인증", patent: "특허", award: "수상" };
// 연혁 분류(회사소개서 연혁 쪽 묶음) — lib/company/profile.ts HISTORY_CATEGORIES 와 같은 값
const HISTORY_CATEGORY_OPTIONS = ["설립", "등록", "인증", "특허", "수상", "조직", "사업"];

// 면허/인증 명칭 선택지 — 직접 입력도 가능(datalist)
const LICENSE_PRESETS = ["환경컨설팅회사", "엔지니어링 컨설팅업", "통합허가 대행업", "환경전문공사업", "기업부설연구소"];
const CERT_PRESETS = ["이노비즈(기술혁신형 중소기업)", "벤처기업 확인", "ISO 9001", "ISO 14001", "특허", "메인비즈"];

// 재정상황 표 열 — 연도 외 금액은 원 단위 숫자 문자열(표준재무제표 LLM 추출)
const FINANCE_COLS: { key: keyof FinanceRow; label: string }[] = [
  { key: "year", label: "연도" },
  { key: "capital", label: "자본금" },
  { key: "totalAssets", label: "자산총계" },
  { key: "totalLiabilities", label: "부채총계" },
  { key: "equity", label: "자기자본" },
  { key: "revenue", label: "매출액" },
  { key: "operatingProfit", label: "영업이익" },
];

/** 원 단위 숫자 문자열 → 천단위 콤마 표시(음수·비숫자 문자는 정리). */
function fmtComma(value: string): string {
  const raw = value.replace(/[^\d-]/g, "");
  if (!raw || raw === "-") return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n.toLocaleString("ko-KR") : value;
}

/** 콤마 표시 입력 → 저장용 숫자 문자열. */
function stripComma(value: string): string {
  return value.replace(/[^\d-]/g, "");
}

const emptyCredentialDraft = {
  credentialId: null as string | null,
  kind: "license" as CredentialKind,
  name: "",
  credentialNo: "",
  issuedAt: "",
  validUntil: "",
  issuer: "",
  note: "",
  /** 문서 분석으로 새로 붙인 증빙(저장 전). null = 기존 파일 유지 */
  file: null as { storageKey: string; fileName: string } | null,
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
  const [histCategory, setHistCategory] = useState("");
  const [histEditing, setHistEditing] = useState<string | null>(null);
  const [histBusy, setHistBusy] = useState(false);

  // 면허/인증 입력
  const [credDraft, setCredDraft] = useState({ ...emptyCredentialDraft });
  const [credBusy, setCredBusy] = useState(false);
  const [parsing, setParsing] = useState(false);

  // 재무제표/등급서 분석
  const [financeParsing, setFinanceParsing] = useState(false);
  const [creditParsing, setCreditParsing] = useState(false);
  const [creditImageUploading, setCreditImageUploading] = useState(false);

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
          body: JSON.stringify({ historyId: histEditing, eventYm: histYm, content: histContent, category: histCategory }),
        })) as { history: HistoryItem[] };
        setHistory(data.history);
      } else {
        const data = (await jfetch("/api/admin/company-profile/history", {
          method: "POST",
          body: JSON.stringify({ eventYm: histYm, content: histContent, category: histCategory }),
        })) as { history: HistoryItem[] };
        setHistory(data.history);
      }
      setHistYm("");
      setHistContent("");
      setHistCategory("");
      setHistEditing(null);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setHistBusy(false);
    }
  };

  // 연혁 공개·강조 토글 — 회사소개서 연혁 쪽에 실을지/굵게 보일지
  const patchHistory = async (historyId: string, patch: { isPublic?: boolean; highlight?: boolean }) => {
    try {
      const data = (await jfetch("/api/admin/company-profile/history", {
        method: "PUT",
        body: JSON.stringify({ historyId, ...patch }),
      })) as { history: HistoryItem[] };
      setHistory(data.history);
    } catch (err) {
      alert((err as Error).message);
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
      })) as { credentials: Credential[]; history: HistoryItem[] };
      setCredentials(data.credentials);
      setHistory(data.history ?? history);
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
      const data = (await jfetch(`/api/admin/company-profile/credentials?credentialId=${encodeURIComponent(credentialId)}`, { method: "DELETE" })) as { credentials: Credential[]; history: HistoryItem[] };
      setCredentials(data.credentials);
      setHistory(data.history ?? history);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const toggleCredentialPublic = async (c: Credential) => {
    try {
      const data = (await jfetch("/api/admin/company-profile/credentials", {
        method: "PATCH",
        body: JSON.stringify({ credentialId: c.credentialId, isPublic: !c.isPublic }),
      })) as { credentials: Credential[] };
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
        fields: { kind: "license" | "certification"; name: string; credentialNo: string; issuedAt: string; validUntil: string; issuer: string } | null;
        file: { storageKey: string; fileName: string };
        warning?: string;
      };
      const fields = data.fields;
      // 수정 중인 항목에 문서를 올리면 증빙만 교체하고 항목 id 는 유지한다
      setCredDraft((prev) =>
        fields
          ? {
              ...prev,
              kind: prev.credentialId ? prev.kind : fields.kind,
              name: fields.name || prev.name,
              credentialNo: fields.credentialNo,
              issuedAt: fields.issuedAt,
              validUntil: fields.validUntil,
              issuer: fields.issuer,
              file: data.file,
            }
          : { ...prev, file: data.file }
      );
      if (data.warning) alert(data.warning);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setParsing(false);
    }
  };

  // 표준재무제표 업로드 → 연도별 행 추출(같은 연도는 교체 병합)
  const parseFinanceFile = async (file: File) => {
    if (!profile) return;
    setFinanceParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = (await jfetch("/api/admin/company-profile/finance/parse", { method: "POST", body: fd })) as { rows: FinanceRow[] };
      const merged = [...profile.finance];
      for (const row of data.rows) {
        const idx = merged.findIndex((f) => f.year === row.year);
        if (idx >= 0) merged[idx] = row;
        else merged.push(row);
      }
      merged.sort((a, b) => b.year.localeCompare(a.year));
      set({ finance: merged });
      alert(`재정상황 ${data.rows.length}개 연도를 추출했습니다. 확인 후 '일반현황 저장'을 눌러 주세요.`);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setFinanceParsing(false);
    }
  };

  // 등급 확인서 이미지(등급 표시부 크롭) 업로드 — 입찰 패키지 신용평가 서식에 삽입됨
  const uploadCreditImage = async (file: File) => {
    setCreditImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = (await jfetch("/api/admin/company-profile/credit/image", { method: "POST", body: fd })) as {
        creditImage: { storageKey: string; fileName: string };
      };
      setProfile((prev) => (prev ? { ...prev, creditImage: data.creditImage } : prev));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCreditImageUploading(false);
    }
  };

  // 신용평가 등급서 업로드 → 새 등급 행으로 추가(민간 CLIP·공공 등 종류별 복수 보유)
  const parseCreditFile = async (file: File) => {
    if (!profile) return;
    setCreditParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = (await jfetch("/api/admin/company-profile/credit/parse", { method: "POST", body: fd })) as {
        fields: CreditRow;
      };
      set({ credit: [...profile.credit, data.fields] });
      alert("신용평가 등급을 추출해 행으로 추가했습니다. 확인 후 '일반현황 저장'을 눌러 주세요.");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCreditParsing(false);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Building2 className="w-5 h-5" />}
        eyebrow="System · Company"
        title="회사 프로필 관리"
        help="자사 일반현황·연혁·면허/인증 보유현황을 관리합니다. 입찰 증빙서류 패키지 생성 시 이 데이터가 사용됩니다."
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
            <CdHelp topic="admin.company-save" />
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
                <L label="홈페이지"><input className="cd-input" value={profile.website} onChange={(e) => set({ website: e.target.value })} placeholder="www.koensain.kr" /></L>
                <L label="대표 메일"><input className="cd-input" value={profile.email} onChange={(e) => set({ email: e.target.value })} /></L>
                <div className="md:col-span-3">
                  <L label="주소"><input className="cd-input" value={profile.address} onChange={(e) => set({ address: e.target.value })} /></L>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 mb-2">
                <h4 className="text-[12px] font-bold cd-text">신용평가 등급</h4>
                <span className="text-[10px] cd-text-faint">민간(CLIP)·공공 등 평가 종류별 복수 등록</span>
                <div className="ml-auto flex items-center gap-2">
                  {profile.creditImage && (
                    <span className="text-[10px] cd-text-faint truncate max-w-[160px]" title={profile.creditImage.fileName}>
                      등급 이미지: {profile.creditImage.fileName}
                    </span>
                  )}
                  <UploadButton
                    label={creditImageUploading ? "업로드 중..." : profile.creditImage ? "등급 이미지 교체" : "등급 이미지"}
                    busy={creditImageUploading}
                    accept=".png,.jpg,.jpeg,.webp"
                    title="등급 확인서에서 등급 표시부를 캡처한 이미지를 올려두면, 입찰 서류 패키지 생성 시 신용평가 서식의 스캔 자리에 자동 삽입됩니다."
                    onFile={uploadCreditImage}
                  />
                  <button
                    type="button"
                    className="cd-btn cd-btn-soft rounded-lg px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1"
                    onClick={() => set({ credit: [...profile.credit, { agency: "", ratingType: "", creditGrade: "", ratedAt: "" }] })}
                  >
                    <Plus className="w-3.5 h-3.5" /> 추가
                  </button>
                  <UploadButton
                    label={creditParsing ? "분석 중..." : "등급서 분석"}
                    busy={creditParsing}
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    title="신용평가 등급서(1~3페이지만 분석)를 업로드하면 신용평가회사·평가 종류·등급·평가일이 행으로 추가됩니다."
                    onFile={parseCreditFile}
                  />
                </div>
              </div>
              {profile.credit.length === 0 ? (
                <p className="rounded-xl border cd-border-c px-3 py-2.5 text-[11px] cd-text-faint">
                  등급서를 분석하거나 추가 버튼으로 평가 종류별 등급을 등록하세요.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {profile.credit.map((c, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_100px_120px_32px] gap-2 text-xs items-center">
                      <input className="cd-input" value={c.agency} placeholder="신용평가회사" onChange={(e) => set({ credit: profile.credit.map((x, j) => (j === i ? { ...x, agency: e.target.value } : x)) })} />
                      <input className="cd-input" value={c.ratingType} placeholder="평가 종류 (민간 CLIP / 공공 등)" onChange={(e) => set({ credit: profile.credit.map((x, j) => (j === i ? { ...x, ratingType: e.target.value } : x)) })} />
                      <input className="cd-input" value={c.creditGrade} placeholder="등급" onChange={(e) => set({ credit: profile.credit.map((x, j) => (j === i ? { ...x, creditGrade: e.target.value } : x)) })} />
                      <input className="cd-input" value={c.ratedAt} placeholder="평가일" onChange={(e) => set({ credit: profile.credit.map((x, j) => (j === i ? { ...x, ratedAt: e.target.value } : x)) })} />
                      <button type="button" className="cd-btn cd-btn-ghost rounded-lg p-1.5" onClick={() => set({ credit: profile.credit.filter((_, j) => j !== i) })}>
                        <Trash2 className="w-3.5 h-3.5 cd-text-faint" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 mt-4 mb-3">
                <h4 className="text-[12px] font-bold cd-text">재정상황</h4>
                <span className="text-[10px] cd-text-faint">홈택스 표준재무제표만 가능 · 금액은 원 단위</span>
                <div className="ml-auto">
                  <UploadButton
                    label={financeParsing ? "분석 중..." : "표준재무제표 분석"}
                    busy={financeParsing}
                    accept=".pdf"
                    title="홈택스에서 출력한 표준재무제표 PDF만 업로드할 수 있습니다. 연도별 자본금·자산총계·부채총계·자기자본·매출액·영업이익이 자동 입력됩니다."
                    onFile={parseFinanceFile}
                  />
                </div>
              </div>
              {profile.finance.length === 0 ? (
                <p className="rounded-xl border cd-border-c px-3 py-2.5 text-[11px] cd-text-faint">
                  표준재무제표를 업로드하면 연도별 재정상황이 추출됩니다.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border cd-border-c">
                  <table className="w-full text-[11px]">
                    <thead className="cd-table-head">
                      <tr className="border-b cd-border-c">
                        {FINANCE_COLS.map((c) => (
                          <th key={c.key} className="px-2 py-1.5 text-left cd-text-faint font-semibold whitespace-nowrap">{c.label}</th>
                        ))}
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {profile.finance.map((f, i) => (
                        <tr key={i} className="border-b cd-border-c last:border-b-0">
                          {FINANCE_COLS.map((c) => (
                            <td key={c.key} className="px-1 py-1">
                              <input
                                className={"cd-input !px-2 !py-1 text-[11px] font-mono" + (c.key === "year" ? "" : " text-right")}
                                style={{ minWidth: c.key === "year" ? 64 : 108 }}
                                value={c.key === "year" ? f.year : fmtComma(f[c.key])}
                                onChange={(e) =>
                                  set({
                                    finance: profile.finance.map((x, j) =>
                                      j === i ? { ...x, [c.key]: c.key === "year" ? e.target.value : stripComma(e.target.value) } : x
                                    ),
                                  })
                                }
                              />
                            </td>
                          ))}
                          <td className="px-1">
                            <button type="button" className="cd-btn cd-btn-ghost rounded p-1" onClick={() => set({ finance: profile.finance.filter((_, j) => j !== i) })}>
                              <Trash2 className="w-3.5 h-3.5 cd-text-faint" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 주요 연혁 (상단 우측) */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-1 flex flex-col">
              <h3 className="font-bold cd-text flex items-center gap-2 mb-3">
                <History className="w-4 h-4 cd-text-primary" /> 주요 연혁
                <span className="ml-auto text-[11px] font-normal cd-text-faint">{history.length}건</span>
              </h3>
              {/* 연월·주요내용 분리 입력 */}
              <div className="rounded-xl border cd-border-c p-3 mb-3 grid gap-2 text-xs">
                <div className="flex items-end gap-2">
                  <L label="연월">
                    <input className="cd-input !w-[120px]" value={histYm} onChange={(e) => setHistYm(e.target.value)} placeholder="2025-01" />
                  </L>
                  <L label="분류">
                    {/* cd-select 는 기본 너비 100% — 인라인 width 로 고정 */}
                    <select className="cd-select" style={{ width: 96 }} value={histCategory} onChange={(e) => setHistCategory(e.target.value)}>
                      <option value="">미분류</option>
                      {HISTORY_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </L>
                  <div className="ml-auto pb-2"><CdHelp topic="admin.company-history-auto" /></div>
                </div>
                <L label="주요내용">
                  <input className="cd-input" value={histContent} onChange={(e) => setHistContent(e.target.value)} placeholder="예: 기술혁신형 중소기업(Inno-Biz) 인증" />
                </L>
                <div className="flex justify-end gap-2">
                  {histEditing && (
                    <button type="button" className="cd-btn cd-btn-ghost rounded-lg px-2 py-1.5 text-xs" onClick={() => { setHistEditing(null); setHistYm(""); setHistContent(""); setHistCategory(""); }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button type="button" onClick={submitHistory} disabled={histBusy} className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                    {histEditing ? "수정" : "추가"}
                  </button>
                </div>
              </div>
              {/* 타임라인 — 영업 스케쥴 이력과 같은 세로선+노드 형태 */}
              <div className="relative pl-5 flex-1 min-h-[160px] max-h-[430px] overflow-y-auto scrollbar-hide">
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
                      <span className={"text-xs flex-1 " + (h.isPublic ? "cd-text" : "cd-text-faint")}>
                        {h.highlight && <Star className="w-3 h-3 inline mr-1 -mt-0.5" style={{ color: "var(--cd-warning)" }} aria-label="강조" />}
                        {h.content}
                        {h.sourceTable && (
                          <span className="ml-1.5 text-[10px] rounded-full px-1.5 py-0.5 border cd-border-c cd-text-faint whitespace-nowrap" title="면허·인증에서 자동으로 만든 연혁입니다. 연월·내용은 원본 면허·인증에서 고칩니다.">
                            {h.category || "인증"} 자동
                          </span>
                        )}
                        {!h.isPublic && <span className="ml-1.5 text-[10px] cd-text-faint whitespace-nowrap">비공개</span>}
                      </span>
                      <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex gap-1 shrink-0">
                        <button type="button" className="cd-btn cd-btn-ghost rounded p-1" title={h.isPublic ? "회사소개서 연혁에서 빼기" : "회사소개서 연혁에 싣기"} aria-label={h.isPublic ? "비공개로" : "공개로"} onClick={() => patchHistory(h.historyId, { isPublic: !h.isPublic })}>
                          {h.isPublic ? <Eye className="w-3 h-3 cd-text-faint" /> : <EyeOff className="w-3 h-3 cd-text-faint" />}
                        </button>
                        <button type="button" className="cd-btn cd-btn-ghost rounded p-1" title={h.highlight ? "강조 해제" : "주요 연혁으로 강조"} aria-label={h.highlight ? "강조 해제" : "강조"} onClick={() => patchHistory(h.historyId, { highlight: !h.highlight })}>
                          <Star className="w-3 h-3 cd-text-faint" />
                        </button>
                        {!h.sourceTable && (
                          <>
                            <button type="button" className="cd-btn cd-btn-ghost rounded p-1" onClick={() => { setHistEditing(h.historyId); setHistYm(h.eventYm); setHistContent(h.content); setHistCategory(h.category); }}>
                              <Pencil className="w-3 h-3 cd-text-faint" />
                            </button>
                            <button type="button" className="cd-btn cd-btn-ghost rounded p-1" onClick={() => removeHistory(h.historyId)}>
                              <Trash2 className="w-3 h-3 cd-text-faint" />
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* 하단: 인적구성(1) · 주요 사업내용(1.5) · 면허/인증(1.5) */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.5fr_1.5fr] gap-4">
            {/* 인적구성 (자동 집계) */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 flex flex-col">
              <h3 className="font-bold cd-text flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 cd-text-primary" /> 인적구성
              </h3>
              <p className="text-[11px] cd-text-faint mb-3">
                통합허가 대행업 기준 — 사용자 등록의 인원 상세 <b>환경부 등급(대행업)</b> 값으로 자동
                집계됩니다(재직자 기준).
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
                인원별 등급은 사용자 등록에서 관리 →
              </Link>
            </section>

            {/* 주요 사업내용 */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 flex flex-col">
              <h3 className="font-bold cd-text flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 cd-text-primary" /> 주요 사업내용
              </h3>
              <textarea
                className="cd-input text-xs flex-1 min-h-[180px] resize-none"
                value={profile.mainBusiness}
                onChange={(e) => set({ mainBusiness: e.target.value })}
                placeholder="예: 통합환경허가 대행, 환경컨설팅, 대기·수질 측정 분석 …"
              />
              <p className="text-[10px] cd-text-faint mt-2">일반현황 저장 버튼으로 함께 저장됩니다.</p>
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
                  {/* cd-select 는 기본 너비 100% — 인라인 width 로 고정해야 옆 명칭 입력란이 살아남는다 */}
                  <select className="cd-select shrink-0" style={{ width: 120 }} value={credDraft.kind} onChange={(e) => setCredDraft((p) => ({ ...p, kind: e.target.value as CredentialKind }))}>
                    <option value="license">면허/등록증</option>
                    <option value="certification">인증</option>
                    <option value="patent">특허</option>
                    <option value="award">수상</option>
                  </select>
                  <input
                    className="cd-input flex-1 min-w-0"
                    list="credential-name-presets"
                    value={credDraft.name}
                    onChange={(e) => setCredDraft((p) => ({ ...p, name: e.target.value }))}
                    placeholder="명칭 선택 또는 직접 입력"
                  />
                  <datalist id="credential-name-presets">
                    {(credDraft.kind === "license" ? LICENSE_PRESETS : credDraft.kind === "certification" ? CERT_PRESETS : []).map((n) => <option key={n} value={n} />)}
                  </datalist>
                  <UploadButton
                    label={parsing ? "분석 중..." : "문서 분석"}
                    busy={parsing}
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    title="면허/인증 문서(PDF·이미지)를 업로드하면 LLM 분석으로 명칭·번호·취득일·유효기간을 자동 입력합니다."
                    onFile={parseCredentialFile}
                  />
                </div>
                <input className="cd-input" value={credDraft.credentialNo} onChange={(e) => setCredDraft((p) => ({ ...p, credentialNo: e.target.value }))} placeholder="번호 (예: 제 44호)" />
                <input className="cd-input" value={credDraft.issuer} onChange={(e) => setCredDraft((p) => ({ ...p, issuer: e.target.value }))} placeholder="발급기관" />
                <input className="cd-input" value={credDraft.issuedAt} onChange={(e) => setCredDraft((p) => ({ ...p, issuedAt: e.target.value }))} placeholder="취득일 (2021-08-05)" />
                <input className="cd-input" value={credDraft.validUntil} onChange={(e) => setCredDraft((p) => ({ ...p, validUntil: e.target.value }))} placeholder="유효기간 만료일 (없으면 비움)" />
                <div className="md:col-span-2 flex items-center justify-end gap-2">
                  {(credDraft.file || (credDraft.credentialId && credentials.find((c) => c.credentialId === credDraft.credentialId)?.file)) && (
                    <span className="mr-auto text-[10px] cd-text-faint inline-flex items-center gap-1 truncate">
                      <Paperclip className="w-3 h-3 shrink-0" />
                      증빙: {credDraft.file?.fileName ?? credentials.find((c) => c.credentialId === credDraft.credentialId)?.file?.fileName}
                    </span>
                  )}
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
                      {CREDENTIAL_KIND_LABEL[c.kind] ?? "면허"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={"font-semibold truncate " + (c.isPublic ? "cd-text" : "cd-text-faint")}>
                        {c.name}{c.credentialNo ? ` (${c.credentialNo})` : ""}
                        {!c.isPublic && <span className="ml-1.5 text-[10px] font-normal">비공개</span>}
                      </p>
                      <p className="text-[10px] cd-text-faint truncate">
                        {[c.issuedAt && `취득 ${c.issuedAt}`, c.validUntil && `유효 ~${c.validUntil}`, c.issuer].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {c.file && (
                      <a
                        href={`/api/admin/company-profile/credentials/file?credentialId=${encodeURIComponent(c.credentialId)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="cd-btn cd-btn-ghost rounded p-1 shrink-0"
                        title={`증빙 열기: ${c.file.fileName}`}
                        aria-label="증빙 열기"
                      >
                        <Paperclip className="w-3 h-3 cd-text-faint" />
                      </a>
                    )}
                    <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex gap-1 shrink-0">
                      <button type="button" className="cd-btn cd-btn-ghost rounded p-1" title={c.isPublic ? "회사소개서에서 빼기" : "회사소개서에 싣기"} aria-label={c.isPublic ? "비공개로" : "공개로"} onClick={() => toggleCredentialPublic(c)}>
                        {c.isPublic ? <Eye className="w-3 h-3 cd-text-faint" /> : <EyeOff className="w-3 h-3 cd-text-faint" />}
                      </button>
                      <button type="button" className="cd-btn cd-btn-ghost rounded p-1" onClick={() => setCredDraft({ credentialId: c.credentialId, kind: c.kind, name: c.name, credentialNo: c.credentialNo, issuedAt: c.issuedAt, validUntil: c.validUntil, issuer: c.issuer, note: c.note, file: null })}>
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

function UploadButton({
  label,
  busy,
  accept,
  title,
  onFile,
}: {
  label: string;
  busy: boolean;
  accept: string;
  title: string;
  onFile: (file: File) => void;
}) {
  return (
    <label className="cd-btn cd-btn-soft rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer inline-flex items-center gap-1 shrink-0" title={title}>
      <Wand2 className="w-3.5 h-3.5" />
      {label}
      <input
        type="file"
        className="hidden"
        accept={accept}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
