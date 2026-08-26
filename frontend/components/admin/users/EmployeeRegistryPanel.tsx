"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type React from "react";
import { BriefcaseBusiness, FileUp, GraduationCap, History, Home, Plus, Save, Trash2, UserRoundCog, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import type {
  DepartmentRow,
  OrganizationEmployeeRow,
  OrganizationSnapshot,
  PositionRow,
} from "./types";

interface EmployeeRegistryPanelProps {
  snapshot: OrganizationSnapshot | null;
  selectedDept: DepartmentRow | null;
  selectedEmployee: OrganizationEmployeeRow | null;
  onReload: () => void;
  toast: (message: string, type?: "success" | "error") => void;
}

type TabKey = "basic" | "education" | "evidence" | "hr";

// 수행인력 명단 연동 등급/분야 옵션 (서버 lib와 값 동일 — 서버 전용 모듈 임포트 회피를 위해 로컬 정의)
const ENG_GRADE_OPTIONS = ["기술사", "특급", "고급", "중급", "초급"] as const;
const ENV_GRADE_OPTIONS = ["고급인력", "일반인력", "미구분"] as const;
const SPECIALTY_OPTIONS = ["대기관리", "수질관리"] as const;

/** 환경부 등급 표시 라벨: 전문분야가 대기관리면 '(대기)'를 부착한다. */
function envGradeLabel(envGrade?: string | null, specialtyField?: string | null): string {
  const base = (envGrade ?? "").trim();
  if (!base) return "";
  return specialtyField === "대기관리" ? `${base}(대기)` : base;
}

interface EmployeeDetail {
  employeeId?: string;
  userId?: string | null;
  employeeNo?: string | null;
  name: string;
  deptId?: string | null;
  positionId?: string | null;
  hiredAt?: string | null;
  jobDuties?: string | null;
  agentRegisteredAt?: string | null;
  engGrade?: string | null;
  envGrade?: string | null;
  specialtyField?: string | null;
  address?: string | null;
  residentRegistrationNo?: string;
  residentRegistrationMasked?: string | null;
  birthDate?: string | null;
  gender?: "male" | "female" | null;
  mobilePhone?: string | null;
  email?: string | null;
  companyPhone?: string | null;
  status?: "active" | "inactive";
  memo?: string | null;
  educations: EducationRow[];
  certifications: CertificationRow[];
  careers: CareerRow[];
  housingSupports: HousingRow[];
  documents: DocumentRow[];
}

interface EducationRow {
  educationId?: string;
  degreeLevel: "bachelor" | "master" | "doctor";
  schoolName: string;
  major?: string | null;
  degreeName?: string | null;
  admissionDate?: string | null;
  graduationDate?: string | null;
}

interface CertificationRow {
  certificationId?: string;
  certificationName: string;
  passedAt?: string | null;
  issuedAt?: string | null;
  certificationNo?: string | null;
}

interface CareerRow {
  careerId?: string;
  workedFrom?: string | null;
  workedTo?: string | null;
  companyName?: string | null;
  finalPosition?: string | null;
  responsibilities?: string | null;
}

interface HousingRow {
  housingId?: string;
  leaseStartedAt?: string | null;
  leaseEndedAt?: string | null;
  monthlyRent?: number | null;
  depositAmount?: number | null;
  address?: string | null;
  landlordName?: string | null;
  memo?: string | null;
}

interface DocumentRow {
  documentId: string;
  documentType: string;
  displayName: string;
  originalFilename: string | null;
  publicPath: string | null;
  storageKey: string;
  targetTable?: string;
  targetId?: string | null;
}

/** 증빙 업로드 — opts.targetTable/targetId 로 학력·자격 행별 연결. */
type UploadDocumentFn = (
  file: File,
  documentType: string,
  displayName: string,
  opts?: { targetTable?: string; targetId?: string | null }
) => Promise<void>;

const CERTIFICATION_OPTIONS = [
  "대기관리기술사",
  "수질관리기술사",
  "대기환경기사",
  "수질환경기사",
  "폐기물처리기사",
  "온실가스관리기사",
  "토양환경기사",
  "소음진동기사",
  "화공기사",
  "산업안전기사",
];

const emptyEmployee = (deptId?: string | null): EmployeeDetail => ({
  name: "",
  deptId: deptId ?? null,
  positionId: null,
  status: "active",
  educations: [],
  certifications: [],
  careers: [],
  housingSupports: [],
  documents: [],
});

export default function EmployeeRegistryPanel({
  snapshot,
  selectedDept,
  selectedEmployee,
  onReload,
  toast,
}: EmployeeRegistryPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  const [employee, setEmployee] = useState<EmployeeDetail>(() => emptyEmployee(selectedDept?.deptId));
  const [departmentDraft, setDepartmentDraft] = useState({
    deptName: "",
    deptKind: "division",
    parentDeptId: "",
    accentColor: "#16A34A",
    positionIds: [] as string[],
  });
  const [saving, setSaving] = useState(false);

  const positions = snapshot?.positions ?? [];
  const departments = snapshot?.departments ?? [];

  useEffect(() => {
    if (!selectedDept) return;
    const allowed = snapshot?.departmentPositions
      .filter((item) => item.deptId === selectedDept.deptId)
      .map((item) => item.positionId) ?? [];
    setDepartmentDraft({
      deptName: selectedDept.deptName,
      deptKind: selectedDept.deptKind,
      parentDeptId: selectedDept.parentDeptId ?? "",
      accentColor: selectedDept.accentColor ?? "#16A34A",
      positionIds: allowed,
    });
    setEmployee((prev) => (prev.employeeId ? prev : { ...prev, deptId: selectedDept.deptId }));
  }, [selectedDept, snapshot?.departmentPositions]);

  useEffect(() => {
    if (!selectedEmployee) return;
    let cancelled = false;
    fetch("/api/admin/employees/" + encodeURIComponent(selectedEmployee.employeeId), { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "직원 조회 실패");
        return res.json() as Promise<{ employee: EmployeeDetail }>;
      })
      .then((body) => {
        if (!cancelled) setEmployee({ ...body.employee, residentRegistrationNo: "" });
      })
      .catch((err) => toast("직원 조회 실패: " + (err as Error).message, "error"));
    return () => {
      cancelled = true;
    };
  }, [selectedEmployee, toast]);

  const allowedPositions = useMemo(() => {
    const deptId = employee.deptId || selectedDept?.deptId;
    const allowedIds =
      snapshot?.departmentPositions.filter((item) => item.deptId === deptId).map((item) => item.positionId) ?? [];
    if (!allowedIds.length) return positions;
    return positions.filter((position) => allowedIds.includes(position.positionId));
  }, [employee.deptId, positions, selectedDept?.deptId, snapshot?.departmentPositions]);

  const saveDepartment = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/organization", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deptId: selectedDept?.deptId,
          deptName: departmentDraft.deptName,
          deptKind: departmentDraft.deptKind,
          parentDeptId: departmentDraft.parentDeptId || null,
          accentColor: departmentDraft.accentColor,
          displayOrder: selectedDept?.displayOrder ?? 100,
          positionIds: departmentDraft.positionIds,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "부서 저장 실패");
      toast("부서 설정이 저장되었습니다.");
      onReload();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveDepartmentPositions = async (positionIds: string[]) => {
    if (!departmentDraft.deptName) return;
    const res = await fetch("/api/admin/organization", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deptId: selectedDept?.deptId,
        deptName: departmentDraft.deptName,
        deptKind: departmentDraft.deptKind,
        parentDeptId: departmentDraft.parentDeptId || null,
        accentColor: departmentDraft.accentColor,
        displayOrder: selectedDept?.displayOrder ?? 100,
        positionIds,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "부서 직급 저장 실패");
  };

  const addPosition = async (positionName: string, rankOrder: number, defaultTemplateId?: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/organization/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positionName, rankOrder, defaultTemplateId: defaultTemplateId || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "직급 추가 실패");
      const body = (await res.json()) as { position: PositionRow };
      const nextIds = [...departmentDraft.positionIds, body.position.positionId];
      setDepartmentDraft((prev) => ({ ...prev, positionIds: nextIds }));
      await saveDepartmentPositions(nextIds);
      toast("직급이 추가되었습니다.");
      onReload();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const deletePosition = async (positionId: string) => {
    setSaving(true);
    try {
      const res = await fetch(
        "/api/admin/organization/positions?positionId=" + encodeURIComponent(positionId),
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "직급 삭제 실패");
      setDepartmentDraft((prev) => ({
        ...prev,
        positionIds: prev.positionIds.filter((id) => id !== positionId),
      }));
      toast("직급이 삭제되었습니다.");
      onReload();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveEmployee = async () => {
    setSaving(true);
    try {
      const endpoint = employee.employeeId
        ? "/api/admin/employees/" + encodeURIComponent(employee.employeeId)
        : "/api/admin/employees";
      const res = await fetch(endpoint, {
        method: employee.employeeId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(employee),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "직원 저장 실패");
      const body = (await res.json()) as { employeeId: string };
      setEmployee((prev) => ({ ...prev, employeeId: body.employeeId, residentRegistrationNo: "" }));
      toast("직원 정보가 저장되었습니다.");
      onReload();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const uploadDocument = async (
    file: File,
    documentType: string,
    displayName: string,
    opts?: { targetTable?: string; targetId?: string | null }
  ) => {
    if (!employee.employeeId) {
      toast("직원 정보를 먼저 저장한 뒤 파일을 업로드하세요.", "error");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("employeeId", employee.employeeId);
    form.set("documentType", documentType);
    form.set("displayName", displayName);
    form.set("targetTable", opts?.targetTable ?? "employee_profiles");
    if (opts?.targetId) form.set("targetId", opts.targetId);
    const res = await fetch("/api/admin/employee-documents", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "업로드 실패");
    const body = (await res.json()) as { document: DocumentRow };
    setEmployee((prev) => ({ ...prev, documents: [body.document, ...prev.documents] }));
    toast("증빙 파일이 업로드되었습니다.");
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="cd-card p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] cd-text-primary">Department</p>
            <h2 className="text-xl font-extrabold cd-text">부서 편집</h2>
            <p className="text-sm cd-text-muted mt-1">상위 부서와 해당 부서에서 사용할 직급을 설정합니다.</p>
          </div>
          <span className="cd-title-icon"><BriefcaseBusiness className="w-4 h-4" /></span>
        </div>
        <div className="grid lg:grid-cols-[1fr_0.8fr] gap-4">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="부서명">
              <input className="cd-input" value={departmentDraft.deptName} onChange={(e) => setDepartmentDraft((prev) => ({ ...prev, deptName: e.target.value }))} placeholder="부서명" />
            </Field>
            <Field label="부서 유형">
              <select className="cd-select" value={departmentDraft.deptKind} onChange={(e) => setDepartmentDraft((prev) => ({ ...prev, deptKind: e.target.value }))}>
                <option value="executive">총괄</option>
                <option value="division">본부</option>
                <option value="team">팀</option>
                <option value="lab">연구소</option>
                <option value="branch">지사</option>
                <option value="support">지원</option>
              </select>
            </Field>
            <Field label="상위 부서">
              <select className="cd-select" value={departmentDraft.parentDeptId} onChange={(e) => setDepartmentDraft((prev) => ({ ...prev, parentDeptId: e.target.value }))}>
                <option value="">최상위 부서</option>
                {departments.filter((dept) => dept.deptId !== selectedDept?.deptId).map((dept) => (
                  <option key={dept.deptId} value={dept.deptId}>
                    {dept.deptName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="표시 색상">
              <input className="cd-input h-10 p-1" type="color" value={departmentDraft.accentColor} onChange={(e) => setDepartmentDraft((prev) => ({ ...prev, accentColor: e.target.value }))} />
            </Field>
          </div>
          <div className="rounded-2xl cd-surface-bg border cd-border-c p-4">
            <h3 className="font-semibold cd-text mb-3">사용 가능 직급</h3>
            <PositionTagEditor
              positions={positions}
              activeIds={departmentDraft.positionIds}
              onToggle={(positionId) =>
                setDepartmentDraft((prev) => ({
                  ...prev,
                  positionIds: prev.positionIds.includes(positionId)
                    ? prev.positionIds.filter((id) => id !== positionId)
                    : [...prev.positionIds, positionId],
                }))
              }
              onAdd={addPosition}
              onDelete={deletePosition}
            />
            <button type="button" disabled={saving || !departmentDraft.deptName} onClick={saveDepartment} className="cd-btn cd-btn-primary mt-4">
              부서 저장
            </button>
          </div>
        </div>
      </section>

      <section className="cd-card p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] cd-text-primary">Employee record</p>
            <h2 className="text-xl font-extrabold cd-text flex items-center gap-2">
              사용자 등록·수정
              {employee.status === "inactive" && <span className="cd-pill cd-pill-idle">퇴사자</span>}
            </h2>
          </div>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setEmployee(emptyEmployee(selectedDept?.deptId))}>
            신규 등록
          </button>
        </div>
        <div className="flex gap-1 border-b cd-border-c mb-5">
          <TabButton active={activeTab === "basic"} onClick={() => setActiveTab("basic")} icon={<UserRoundCog className="w-4 h-4" />} label="기본 정보" />
          <TabButton active={activeTab === "education"} onClick={() => setActiveTab("education")} icon={<GraduationCap className="w-4 h-4" />} label="학력/자격" />
          <TabButton active={activeTab === "evidence"} onClick={() => setActiveTab("evidence")} icon={<Home className="w-4 h-4" />} label="기타 증빙" />
          <TabButton active={activeTab === "hr"} onClick={() => setActiveTab("hr")} icon={<History className="w-4 h-4" />} label="인사관리" />
        </div>

        {activeTab === "basic" && (
          <BasicTab employee={employee} setEmployee={setEmployee} departments={departments} positions={allowedPositions} />
        )}
        {activeTab === "education" && (
          <EducationTab employee={employee} setEmployee={setEmployee} uploadDocument={uploadDocument} />
        )}
        {activeTab === "evidence" && (
          <EvidenceTab employee={employee} setEmployee={setEmployee} uploadDocument={uploadDocument} />
        )}
        {activeTab === "hr" && (
          <HrTab
            employee={employee}
            departments={departments}
            positions={positions}
            uploadDocument={uploadDocument}
            toast={toast}
          />
        )}

        <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t cd-border-c">
          <div className="text-xs cd-text-muted">
            주민번호는 서버에서 암호화 저장하며 화면에는 마스킹 값과 생년월일/성별만 표시합니다.
          </div>
          <button type="button" disabled={saving || !employee.name} onClick={saveEmployee} className="cd-btn cd-btn-primary">
            <Save className="w-4 h-4" /> 직원 정보 저장
          </button>
        </div>
      </section>
    </div>
  );
}

function EmployeePhotoField({ employeeId }: { employeeId?: string }) {
  const [ver, setVer] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  if (!employeeId) {
    return (
      <Field label="증명사진">
        <span className="cd-text-faint text-xs">직원을 저장한 뒤 업로드할 수 있습니다.</span>
      </Field>
    );
  }
  const src = `/api/admin/employees/${employeeId}/photo?v=${ver}`;
  const onFile = async (f: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.set("file", f);
    const res = await fetch(`/api/admin/employees/${employeeId}/photo`, { method: "POST", body: fd });
    setUploading(false);
    if (res.ok) {
      setHasPhoto(true);
      setVer((v) => v + 1);
    }
  };
  return (
    <Field label="증명사진">
      <div className="flex items-center gap-3">
        <span className="w-16 h-16 rounded-lg overflow-hidden cd-surface-bg flex items-center justify-center shrink-0">
          {hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="w-full h-full object-cover" onError={() => setHasPhoto(false)} />
          ) : (
            <UserRoundCog className="w-6 h-6 cd-text-faint" />
          )}
        </span>
        <div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "업로드 중…" : "사진 업로드"}
          </button>
          <p className="cd-text-faint text-[11px] mt-1">그룹웨어 메신저·영업 담당자 표시에 사용됩니다.</p>
        </div>
      </div>
    </Field>
  );
}

function BasicTab({
  employee,
  setEmployee,
  departments,
  positions,
}: {
  employee: EmployeeDetail;
  setEmployee: React.Dispatch<React.SetStateAction<EmployeeDetail>>;
  departments: DepartmentRow[];
  positions: PositionRow[];
}) {
  return (
    <div className="grid md:grid-cols-3 gap-3">
      <EmployeePhotoField employeeId={employee.employeeId} />
      <TextField label="성명" value={employee.name} onChange={(value) => setEmployee((prev) => ({ ...prev, name: value }))} />
      <Field label="직급">
        <select className="cd-select" value={employee.positionId ?? ""} onChange={(e) => setEmployee((prev) => ({ ...prev, positionId: e.target.value || null }))}>
          <option value="">직급 선택</option>
          {positions.map((position) => (
            <option key={position.positionId} value={position.positionId}>
              {position.positionName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="부서">
        <select className="cd-select" value={employee.deptId ?? ""} onChange={(e) => setEmployee((prev) => ({ ...prev, deptId: e.target.value || null, positionId: null }))}>
          <option value="">부서 선택</option>
          {departments.map((dept) => (
            <option key={dept.deptId} value={dept.deptId}>
              {dept.deptName}
            </option>
          ))}
        </select>
      </Field>
      <TextField label="입사일" value={employee.hiredAt ?? ""} onChange={(value) => setEmployee((prev) => ({ ...prev, hiredAt: formatDateInput(value) }))} placeholder="YYYY-MM-DD" inputMode="numeric" />
      <TextField label="주민번호" value={employee.residentRegistrationNo ?? ""} onChange={(value) => setEmployee((prev) => ({ ...prev, residentRegistrationNo: formatResidentNo(value) }))} placeholder="000000-0000000" inputMode="numeric" />
      <TextField label="휴대폰" value={employee.mobilePhone ?? ""} onChange={(value) => setEmployee((prev) => ({ ...prev, mobilePhone: formatPhoneNumber(value) }))} inputMode="numeric" />
      <TextField label="이메일" value={employee.email ?? ""} onChange={(value) => setEmployee((prev) => ({ ...prev, email: value }))} />
      <TextField label="회사 직통 번호" value={employee.companyPhone ?? ""} onChange={(value) => setEmployee((prev) => ({ ...prev, companyPhone: formatPhoneNumber(value) }))} inputMode="numeric" />
      <TextField label="담당업무" value={employee.jobDuties ?? ""} onChange={(value) => setEmployee((prev) => ({ ...prev, jobDuties: value }))} placeholder="예: 통합허가 인허가 총괄" />
      <TextField label="대행인력등록일" value={employee.agentRegisteredAt ?? ""} onChange={(value) => setEmployee((prev) => ({ ...prev, agentRegisteredAt: formatDateInput(value) }))} placeholder="YYYY-MM-DD" inputMode="numeric" />
      <Field label="기술등급(엔지니어링)">
        <select className="cd-select" value={employee.engGrade ?? ""} onChange={(e) => setEmployee((prev) => ({ ...prev, engGrade: e.target.value || null }))}>
          <option value="">선택</option>
          {ENG_GRADE_OPTIONS.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </Field>
      <Field label="전문분야">
        <select className="cd-select" value={employee.specialtyField ?? ""} onChange={(e) => setEmployee((prev) => ({ ...prev, specialtyField: e.target.value || null }))}>
          <option value="">선택</option>
          {SPECIALTY_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </Field>
      <Field label="환경부 등급(대행업)">
        <select className="cd-select" value={employee.envGrade ?? ""} onChange={(e) => setEmployee((prev) => ({ ...prev, envGrade: e.target.value || null }))}>
          <option value="">선택</option>
          {ENV_GRADE_OPTIONS.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </Field>
      <label className="md:col-span-3 flex flex-col gap-1">
        <span className="cd-label !mb-0">거주지 주소</span>
        <input className="cd-input" value={employee.address ?? ""} onChange={(e) => setEmployee((prev) => ({ ...prev, address: e.target.value }))} />
      </label>
      <div className="md:col-span-3 grid md:grid-cols-3 gap-3">
        <InfoPill label="마스킹 주민번호" value={employee.residentRegistrationMasked ?? "저장 후 표시"} />
        <InfoPill label="생년월일" value={employee.birthDate ?? "자동 분류"} />
        <InfoPill label="성별" value={employee.gender === "male" ? "남성" : employee.gender === "female" ? "여성" : "자동 분류"} />
        <InfoPill label="환경부 등급(표시)" value={envGradeLabel(employee.envGrade, employee.specialtyField) || "미지정"} />
      </div>
    </div>
  );
}

function EducationTab({
  employee,
  setEmployee,
  uploadDocument,
}: {
  employee: EmployeeDetail;
  setEmployee: React.Dispatch<React.SetStateAction<EmployeeDetail>>;
  uploadDocument: UploadDocumentFn;
}) {
  return (
    <div className="space-y-5">
      <RepeatingSection
        title="학력 정보"
        onAdd={() => setEmployee((prev) => ({ ...prev, educations: [...prev.educations, { degreeLevel: "bachelor", schoolName: "" }] }))}
      >
        {employee.educations.map((item, index) => (
          <div key={index} className="grid md:grid-cols-[repeat(6,1fr)_auto] gap-2 rounded-2xl cd-surface-bg border cd-border-c p-3 items-center">
            <select className="cd-select" value={item.degreeLevel} onChange={(e) => updateArray(setEmployee, "educations", index, { degreeLevel: e.target.value as EducationRow["degreeLevel"] })}>
              <option value="bachelor">학사</option>
              <option value="master">석사</option>
              <option value="doctor">박사</option>
            </select>
            <input className="cd-input" placeholder="출신 학교" value={item.schoolName} onChange={(e) => updateArray(setEmployee, "educations", index, { schoolName: e.target.value })} />
            <input className="cd-input" placeholder="전공" value={item.major ?? ""} onChange={(e) => updateArray(setEmployee, "educations", index, { major: e.target.value })} />
            <input className="cd-input" placeholder="학위" value={item.degreeName ?? ""} onChange={(e) => updateArray(setEmployee, "educations", index, { degreeName: e.target.value })} />
            <input className="cd-input" inputMode="numeric" placeholder="입학일" value={item.admissionDate ?? ""} onChange={(e) => updateArray(setEmployee, "educations", index, { admissionDate: formatDateInput(e.target.value) })} />
            <input className="cd-input" inputMode="numeric" placeholder="졸업일" value={item.graduationDate ?? ""} onChange={(e) => updateArray(setEmployee, "educations", index, { graduationDate: formatDateInput(e.target.value) })} />
            <RowAttach
              targetTable="employee_educations"
              targetId={item.educationId || null}
              documentType="졸업증명서"
              displayName={`졸업증명서(${item.schoolName || "학력"})`}
              documents={employee.documents}
              uploadDocument={uploadDocument}
            />
          </div>
        ))}
      </RepeatingSection>

      <RepeatingSection
        title="자격증"
        onAdd={() => setEmployee((prev) => ({ ...prev, certifications: [...prev.certifications, { certificationName: CERTIFICATION_OPTIONS[0] }] }))}
      >
        {employee.certifications.map((item, index) => (
          <div key={index} className="grid md:grid-cols-[repeat(4,1fr)_auto] gap-2 rounded-2xl cd-surface-bg border cd-border-c p-3 items-center">
            <select className="cd-select" value={item.certificationName} onChange={(e) => updateArray(setEmployee, "certifications", index, { certificationName: e.target.value })}>
              {CERTIFICATION_OPTIONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <input className="cd-input" type="date" value={item.passedAt ?? ""} onChange={(e) => updateArray(setEmployee, "certifications", index, { passedAt: e.target.value })} />
            <input className="cd-input" type="date" value={item.issuedAt ?? ""} onChange={(e) => updateArray(setEmployee, "certifications", index, { issuedAt: e.target.value })} />
            <input className="cd-input" placeholder="자격번호" value={item.certificationNo ?? ""} onChange={(e) => updateArray(setEmployee, "certifications", index, { certificationNo: e.target.value })} />
            <RowAttach
              targetTable="employee_certifications"
              targetId={item.certificationId || null}
              documentType="자격증 사본"
              displayName={`자격증 사본(${item.certificationName || "자격증"})`}
              documents={employee.documents}
              uploadDocument={uploadDocument}
            />
          </div>
        ))}
      </RepeatingSection>

      {/* 졸업증명서·자격증 사본은 각 행의 증빙 버튼으로 업로드(건별 매칭 — 입찰 패키지 첨부 병합용) */}
      <UploadRow uploadDocument={uploadDocument} types={["성적증명서"]} documents={employee.documents} />
    </div>
  );
}

/** 학력·자격 행별 증빙 첨부 — employee_documents 의 target_table/target_id 로 건별 매칭. */
function RowAttach({
  targetTable,
  targetId,
  documentType,
  displayName,
  documents,
  uploadDocument,
}: {
  targetTable: string;
  targetId: string | null;
  documentType: string;
  displayName: string;
  documents: DocumentRow[];
  uploadDocument: UploadDocumentFn;
}) {
  if (!targetId) {
    return <span className="text-[10px] cd-text-faint whitespace-nowrap self-center">저장 후 증빙 첨부</span>;
  }
  const attached = documents.find((d) => d.targetTable === targetTable && d.targetId === targetId);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {attached && (
        <a
          href={attached.publicPath ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="cd-pill cd-pill-info truncate max-w-[140px]"
          title={attached.originalFilename || attached.displayName}
        >
          {attached.originalFilename || attached.displayName}
        </a>
      )}
      <label className="cd-btn cd-btn-soft cursor-pointer !px-2.5 !py-1.5 text-[11px] shrink-0" title={`${documentType} 파일을 이 행에 연결해 업로드합니다.`}>
        <FileUp className="w-3.5 h-3.5" /> {attached ? "교체" : "증빙"}
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadDocument(file, documentType, displayName, { targetTable, targetId });
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}

function EvidenceTab({
  employee,
  setEmployee,
  uploadDocument,
}: {
  employee: EmployeeDetail;
  setEmployee: React.Dispatch<React.SetStateAction<EmployeeDetail>>;
  uploadDocument: UploadDocumentFn;
}) {
  return (
    <div className="space-y-5">
      <RepeatingSection
        title="전근무지 근무 이력"
        onAdd={() => setEmployee((prev) => ({ ...prev, careers: [...prev.careers, {}] }))}
      >
        {employee.careers.map((item, index) => (
          <div key={index} className="grid md:grid-cols-5 gap-2 rounded-2xl cd-surface-bg border cd-border-c p-3">
            <input className="cd-input" inputMode="numeric" placeholder="입사시기" value={item.workedFrom ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { workedFrom: formatMonthInput(e.target.value) })} />
            <input className="cd-input" inputMode="numeric" placeholder="퇴사시기" value={item.workedTo ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { workedTo: formatMonthInput(e.target.value) })} />
            <input className="cd-input" placeholder="근무처" value={item.companyName ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { companyName: e.target.value })} />
            <input className="cd-input" placeholder="최종직위" value={item.finalPosition ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { finalPosition: e.target.value })} />
            <input className="cd-input" placeholder="담당업무" value={item.responsibilities ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { responsibilities: e.target.value })} />
          </div>
        ))}
      </RepeatingSection>

      <RepeatingSection
        title="주거비 지원 임대차 계약"
        onAdd={() => setEmployee((prev) => ({ ...prev, housingSupports: [...prev.housingSupports, {}] }))}
      >
        {employee.housingSupports.map((item, index) => (
          <div key={index} className="grid md:grid-cols-5 gap-2 rounded-2xl cd-surface-bg border cd-border-c p-3">
            <input className="cd-input" type="date" value={item.leaseStartedAt ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { leaseStartedAt: e.target.value })} />
            <input className="cd-input" type="date" value={item.leaseEndedAt ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { leaseEndedAt: e.target.value })} />
            <input className="cd-input" type="number" placeholder="월세액" value={item.monthlyRent ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { monthlyRent: Number(e.target.value || 0) })} />
            <input className="cd-input" type="number" placeholder="보증금" value={item.depositAmount ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { depositAmount: Number(e.target.value || 0) })} />
            <input className="cd-input" placeholder="임대차 주소" value={item.address ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { address: e.target.value })} />
          </div>
        ))}
      </RepeatingSection>

      <UploadRow uploadDocument={uploadDocument} types={["국민연금가입자가입증명", "건강보험자격득실확인서", "기술자 경력확인서", "월세 임대차 계약서"]} documents={employee.documents} />
    </div>
  );
}

function UploadRow({
  uploadDocument,
  types,
  documents,
}: {
  uploadDocument: UploadDocumentFn;
  types: string[];
  documents: DocumentRow[];
}) {
  const [documentType, setDocumentType] = useState(types[0]);
  return (
    <div className="rounded-2xl cd-surface-bg border cd-border-c p-4">
      <h3 className="mb-3 text-sm font-semibold cd-text">증빙 서류 업로드</h3>
      <div className="grid md:grid-cols-[220px_1fr] gap-3 items-center">
        <select className="cd-select" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <label className="cd-btn cd-btn-soft cursor-pointer">
          <FileUp className="w-4 h-4" /> 증빙 파일 업로드
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadDocument(file, documentType, documentType);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {documents
          .filter((doc) => types.includes(doc.documentType))
          .map((doc) => (
            <a key={doc.documentId} href={doc.publicPath ?? "#"} className="cd-pill cd-pill-info" target="_blank" rel="noreferrer">
              {doc.originalFilename || doc.displayName}
            </a>
          ))}
      </div>
    </div>
  );
}

interface HrEventRow {
  eventId: string;
  employeeId: string;
  eventType: "promotion" | "transfer" | "resignation" | "leave_start" | "leave_end";
  eventDate: string;
  positionId: string | null;
  positionName: string | null;
  fromDeptId: string | null;
  toDeptId: string | null;
  fromDeptName: string | null;
  toDeptName: string | null;
  note: string | null;
  createdAt: string;
}

function HrTab({
  employee,
  departments,
  positions,
  uploadDocument,
  toast,
}: {
  employee: EmployeeDetail;
  departments: DepartmentRow[];
  positions: PositionRow[];
  uploadDocument: (
    file: File,
    documentType: string,
    displayName: string,
    opts?: { targetTable?: string; targetId?: string | null }
  ) => Promise<void>;
  toast: (message: string, type?: "success" | "error") => void;
}) {
  const employeeId = employee.employeeId;
  const [events, setEvents] = useState<HrEventRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [promo, setPromo] = useState({ positionId: "", eventDate: "", note: "" });
  const [transfer, setTransfer] = useState({ fromDeptId: "", toDeptId: "", eventDate: "", note: "" });
  const [resign, setResign] = useState({ eventDate: "", note: "" });
  // 휴직(leave_start)/복직(leave_end) — 206. 계정 상태는 바꾸지 않는 이력 기록.
  const [leave, setLeave] = useState({ eventDate: "", note: "" });

  const sortedPositions = [...positions].sort((a, b) => b.rankOrder - a.rankOrder);

  useEffect(() => {
    if (!employeeId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    fetch("/api/admin/employees/" + encodeURIComponent(employeeId) + "/hr-events", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("이력 조회 실패"))))
      .then((d) => {
        if (!cancelled) setEvents((d.events ?? []) as HrEventRow[]);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const reloadEvents = async () => {
    if (!employeeId) return;
    const r = await fetch("/api/admin/employees/" + encodeURIComponent(employeeId) + "/hr-events", { cache: "no-store" });
    if (r.ok) setEvents(((await r.json()).events ?? []) as HrEventRow[]);
  };

  const createEvent = async (payload: Record<string, unknown>): Promise<string | null> => {
    if (!employeeId) {
      toast("직원 정보를 먼저 저장하세요.", "error");
      return null;
    }
    if (!payload.eventDate) {
      toast("일자를 입력하세요.", "error");
      return null;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/employees/" + encodeURIComponent(employeeId) + "/hr-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "기록 실패");
      await reloadEvents();
      toast("인사 이력이 기록되었습니다.");
      return (data.event?.eventId as string) ?? null;
    } catch (e) {
      toast("실패: " + (e as Error).message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async (eventId: string) => {
    if (!employeeId) return;
    if (!confirm("이 인사 이력을 삭제할까요? (첨부 문서도 함께 삭제, 퇴사 이벤트면 재직 상태로 복구)")) return;
    setBusy(true);
    try {
      const res = await fetch(
        "/api/admin/employees/" + encodeURIComponent(employeeId) + "/hr-events?eventId=" + encodeURIComponent(eventId),
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "삭제 실패");
      await reloadEvents();
      toast("인사 이력을 삭제했습니다.");
    } catch (e) {
      toast("실패: " + (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const uploadFor = async (eventId: string, file: File, docType: string) => {
    if (file.type !== "application/pdf") {
      toast("PDF 파일만 업로드할 수 있습니다.", "error");
      return;
    }
    try {
      await uploadDocument(file, docType, docType, { targetTable: "employee_hr_events", targetId: eventId });
    } catch (e) {
      toast("실패: " + (e as Error).message, "error");
    }
  };

  const renderAttach = (eventId: string, docType: string) => {
    const docs = employee.documents.filter((d) => d.targetId === eventId && d.documentType === docType);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label className="cd-btn cd-btn-soft cd-btn-sm cursor-pointer">
          <FileUp className="w-3.5 h-3.5" /> {docType} (PDF)
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFor(eventId, f, docType);
              e.currentTarget.value = "";
            }}
          />
        </label>
        {docs.map((d) => (
          <a key={d.documentId} href={d.publicPath ?? "#"} target="_blank" rel="noreferrer" className="cd-pill cd-pill-info">
            {d.originalFilename || d.displayName}
          </a>
        ))}
      </div>
    );
  };

  if (!employeeId) {
    return <div className="text-sm cd-text-faint py-8 text-center">직원 정보를 먼저 저장하면 인사 이력을 기록할 수 있습니다.</div>;
  }

  const promotions = events.filter((e) => e.eventType === "promotion");
  const transfers = events.filter((e) => e.eventType === "transfer");
  const resignations = events.filter((e) => e.eventType === "resignation");
  const leaves = events.filter((e) => e.eventType === "leave_start" || e.eventType === "leave_end");
  // 현재 휴직 중 = 마지막 휴직 이벤트가 leave_start(events 는 최신순 정렬)
  const onLeave = leaves.length > 0 && leaves[0].eventType === "leave_start";

  return (
    <div className="flex flex-col gap-5">
      {/* 승진 이력 */}
      <section className="rounded-2xl cd-surface-bg border cd-border-c p-4">
        <h3 className="font-bold cd-text mb-3">승진 이력</h3>
        <div className="grid md:grid-cols-[1fr_160px_1fr_auto] gap-2 items-end mb-3">
          <Field label="승진 직급">
            <select className="cd-select" value={promo.positionId} onChange={(e) => setPromo((p) => ({ ...p, positionId: e.target.value }))}>
              <option value="">직급 선택</option>
              {sortedPositions.map((pos) => (
                <option key={pos.positionId} value={pos.positionId}>{pos.positionName}</option>
              ))}
            </select>
          </Field>
          <Field label="승진일자">
            <input type="date" className="cd-input" value={promo.eventDate} onChange={(e) => setPromo((p) => ({ ...p, eventDate: e.target.value }))} />
          </Field>
          <Field label="비고">
            <input className="cd-input" value={promo.note} onChange={(e) => setPromo((p) => ({ ...p, note: e.target.value }))} placeholder="비고(선택)" />
          </Field>
          <button
            type="button"
            disabled={busy || !promo.positionId || !promo.eventDate}
            onClick={async () => {
              const id = await createEvent({ eventType: "promotion", eventDate: promo.eventDate, positionId: promo.positionId, note: promo.note });
              if (id) setPromo({ positionId: "", eventDate: "", note: "" });
            }}
            className="cd-btn cd-btn-primary cd-btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> 기록
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {promotions.map((ev) => (
            <div key={ev.eventId} className="rounded-xl cd-card-bg border cd-border-c p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm cd-text">
                  <b className="cd-text-primary">{ev.positionName ?? "직급"}</b> 승진 · {ev.eventDate}
                  {ev.note && <span className="cd-text-muted"> · {ev.note}</span>}
                </div>
                <button type="button" disabled={busy} onClick={() => removeEvent(ev.eventId)} className="cd-btn cd-btn-danger cd-btn-sm">삭제</button>
              </div>
              {renderAttach(ev.eventId, "인사발령")}
            </div>
          ))}
          {promotions.length === 0 && <div className="text-xs cd-text-faint py-2 text-center">승진 이력이 없습니다.</div>}
        </div>
      </section>

      {/* 부서 이동 이력 */}
      <section className="rounded-2xl cd-surface-bg border cd-border-c p-4">
        <h3 className="font-bold cd-text mb-3">부서 이동 이력</h3>
        <div className="grid md:grid-cols-[1fr_1fr_160px_1fr_auto] gap-2 items-end mb-3">
          <Field label="전 소속">
            <select className="cd-select" value={transfer.fromDeptId} onChange={(e) => setTransfer((t) => ({ ...t, fromDeptId: e.target.value }))}>
              <option value="">선택</option>
              {departments.map((d) => (
                <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
              ))}
            </select>
          </Field>
          <Field label="변경 후 소속">
            <select className="cd-select" value={transfer.toDeptId} onChange={(e) => setTransfer((t) => ({ ...t, toDeptId: e.target.value }))}>
              <option value="">선택</option>
              {departments.map((d) => (
                <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
              ))}
            </select>
          </Field>
          <Field label="이동일자">
            <input type="date" className="cd-input" value={transfer.eventDate} onChange={(e) => setTransfer((t) => ({ ...t, eventDate: e.target.value }))} />
          </Field>
          <Field label="비고">
            <input className="cd-input" value={transfer.note} onChange={(e) => setTransfer((t) => ({ ...t, note: e.target.value }))} placeholder="비고(선택)" />
          </Field>
          <button
            type="button"
            disabled={busy || !transfer.toDeptId || !transfer.eventDate}
            onClick={async () => {
              const id = await createEvent({ eventType: "transfer", eventDate: transfer.eventDate, fromDeptId: transfer.fromDeptId || null, toDeptId: transfer.toDeptId, note: transfer.note });
              if (id) setTransfer({ fromDeptId: "", toDeptId: "", eventDate: "", note: "" });
            }}
            className="cd-btn cd-btn-primary cd-btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> 기록
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {transfers.map((ev) => (
            <div key={ev.eventId} className="rounded-xl cd-card-bg border cd-border-c p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm cd-text">
                  <span className="cd-text-muted">{ev.fromDeptName ?? "—"}</span> → <b className="cd-text-primary">{ev.toDeptName ?? "—"}</b> · {ev.eventDate}
                  {ev.note && <span className="cd-text-muted"> · {ev.note}</span>}
                </div>
                <button type="button" disabled={busy} onClick={() => removeEvent(ev.eventId)} className="cd-btn cd-btn-danger cd-btn-sm">삭제</button>
              </div>
              {renderAttach(ev.eventId, "전보발령")}
            </div>
          ))}
          {transfers.length === 0 && <div className="text-xs cd-text-faint py-2 text-center">부서 이동 이력이 없습니다.</div>}
        </div>
      </section>

      {/* 휴직/복직(206) — 휴직원 승인 시 자동 기록되고, 여기서 수기 기록·복직 처리한다 */}
      <section className="rounded-2xl cd-surface-bg border cd-border-c p-4">
        <h3 className="font-bold cd-text mb-1">
          휴직 {onLeave && <span className="cd-pill cd-pill-info ml-1 align-middle">휴직 중</span>}
        </h3>
        <p className="text-xs cd-text-muted mb-3">휴직원 승인 시 휴직 시작이 자동 기록됩니다. 복직하면 [복직 기록]으로 종료 처리하세요(계정 상태는 바뀌지 않습니다).</p>
        <div className="grid md:grid-cols-[160px_1fr_auto_auto] gap-2 items-end mb-3">
          <Field label="일자">
            <input type="date" className="cd-input" value={leave.eventDate} onChange={(e) => setLeave((l) => ({ ...l, eventDate: e.target.value }))} />
          </Field>
          <Field label="비고">
            <input className="cd-input" value={leave.note} onChange={(e) => setLeave((l) => ({ ...l, note: e.target.value }))} placeholder="예: 육아 휴직 / 복직" />
          </Field>
          <button
            type="button"
            disabled={busy || !leave.eventDate || onLeave}
            onClick={async () => {
              const id = await createEvent({ eventType: "leave_start", eventDate: leave.eventDate, note: leave.note });
              if (id) setLeave({ eventDate: "", note: "" });
            }}
            className="cd-btn cd-btn-primary cd-btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> 휴직 기록
          </button>
          <button
            type="button"
            disabled={busy || !leave.eventDate || !onLeave}
            onClick={async () => {
              const id = await createEvent({ eventType: "leave_end", eventDate: leave.eventDate, note: leave.note });
              if (id) setLeave({ eventDate: "", note: "" });
            }}
            className="cd-btn cd-btn-soft cd-btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> 복직 기록
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {leaves.map((ev) => (
            <div key={ev.eventId} className="rounded-xl cd-card-bg border cd-border-c p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm cd-text">
                  {ev.eventType === "leave_start" ? "휴직" : "복직"} · {ev.eventDate}
                  {ev.note && <span className="cd-text-muted"> · {ev.note}</span>}
                </div>
                <button type="button" disabled={busy} onClick={() => removeEvent(ev.eventId)} className="cd-btn cd-btn-danger cd-btn-sm">삭제</button>
              </div>
              {renderAttach(ev.eventId, ev.eventType === "leave_start" ? "휴직원" : "복직원")}
            </div>
          ))}
          {leaves.length === 0 && <div className="text-xs cd-text-faint py-2 text-center">휴직 이력이 없습니다.</div>}
        </div>
      </section>

      {/* 퇴사 */}
      <section className="rounded-2xl cd-surface-bg border cd-border-c p-4">
        <h3 className="font-bold cd-text mb-1">퇴사</h3>
        <p className="text-xs cd-text-muted mb-3">퇴사 기록 시 퇴사일이 지났으면 즉시, 미래(퇴사 예정)면 퇴사일 도래 시 인원·계정이 비활성화됩니다. 이력 삭제 시 복구됩니다.</p>
        <div className="grid md:grid-cols-[160px_1fr_auto] gap-2 items-end mb-3">
          <Field label="퇴사일자">
            <input type="date" className="cd-input" value={resign.eventDate} onChange={(e) => setResign((r) => ({ ...r, eventDate: e.target.value }))} />
          </Field>
          <Field label="비고">
            <input className="cd-input" value={resign.note} onChange={(e) => setResign((r) => ({ ...r, note: e.target.value }))} placeholder="비고(선택)" />
          </Field>
          <button
            type="button"
            disabled={busy || !resign.eventDate || resignations.length > 0}
            onClick={async () => {
              const id = await createEvent({ eventType: "resignation", eventDate: resign.eventDate, note: resign.note });
              if (id) setResign({ eventDate: "", note: "" });
            }}
            className="cd-btn cd-btn-primary cd-btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> 기록
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {resignations.map((ev) => (
            <div key={ev.eventId} className="rounded-xl cd-card-bg border cd-border-c p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm cd-text">
                  퇴사 · {ev.eventDate}
                  {ev.note && <span className="cd-text-muted"> · {ev.note}</span>}
                </div>
                <button type="button" disabled={busy} onClick={() => removeEvent(ev.eventId)} className="cd-btn cd-btn-danger cd-btn-sm">삭제</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {renderAttach(ev.eventId, "퇴직원")}
                {renderAttach(ev.eventId, "퇴직정산")}
              </div>
            </div>
          ))}
          {resignations.length === 0 && <div className="text-xs cd-text-faint py-2 text-center">퇴사 기록이 없습니다.</div>}
        </div>
      </section>

      {/* 경비/급여 입금 계좌(203) — 개인카드 경비 정산 CMS 파일에 자동 기입된다 */}
      <BankAccountSection employeeId={employeeId} toast={toast} />
    </div>
  );
}

/** 경비/급여 입금 계좌 편집 — 전용 PATCH(bank-account) 경로. 은행코드는 금융결제원 표준 숫자 코드. */
function BankAccountSection({ employeeId, toast }: { employeeId: string; toast: (message: string, type?: "success" | "error") => void }) {
  const [form, setForm] = useState({ bankCode: "", bankAccount: "", accountHolder: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/employees/" + encodeURIComponent(employeeId) + "/bank-account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setForm({ bankCode: d.bankCode ?? "", bankAccount: d.bankAccount ?? "", accountHolder: d.accountHolder ?? "" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/employees/" + encodeURIComponent(employeeId) + "/bank-account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "저장 실패");
      toast("입금 계좌를 저장했습니다.");
    } catch (e) {
      toast("실패: " + (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl cd-surface-bg border cd-border-c p-4">
      <h3 className="font-bold cd-text mb-1">경비/급여 입금 계좌</h3>
      <p className="text-xs cd-text-faint mb-3">개인카드 경비 정산의 CMS 이체 파일에 자동 기입됩니다. 은행코드는 금융결제원 표준 숫자 코드(예: 국민 4, 기업 3, 신한 88, 우리 20, 농협 11).</p>
      <div className="grid md:grid-cols-[120px_1fr_160px_auto] gap-2 items-end">
        <Field label="은행코드">
          <input className="cd-input" inputMode="numeric" placeholder="예: 4" value={form.bankCode} onChange={(e) => setForm((f) => ({ ...f, bankCode: e.target.value.replace(/\D/g, "") }))} />
        </Field>
        <Field label="계좌번호">
          <input className="cd-input" inputMode="numeric" placeholder="숫자만 입력" value={form.bankAccount} onChange={(e) => setForm((f) => ({ ...f, bankAccount: e.target.value.replace(/[^\d-]/g, "") }))} />
        </Field>
        <Field label="예금주(본인이면 비움)">
          <input className="cd-input" value={form.accountHolder} onChange={(e) => setForm((f) => ({ ...f, accountHolder: e.target.value }))} />
        </Field>
        <button type="button" disabled={busy} onClick={() => void save()} className="cd-btn cd-btn-primary cd-btn-sm">저장</button>
      </div>
    </section>
  );
}

function PositionTagEditor({
  positions,
  activeIds,
  onToggle,
  onAdd,
  onDelete,
}: {
  positions: PositionRow[];
  activeIds: string[];
  onToggle: (positionId: string) => void;
  onAdd: (positionName: string, rankOrder: number, defaultTemplateId?: string) => Promise<void>;
  onDelete: (positionId: string) => Promise<void>;
}) {
  const { theme } = useCdashTheme();
  const sortedPositions = [...positions].sort((a, b) => b.rankOrder - a.rankOrder);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PositionRow | null>(null);
  const [positionName, setPositionName] = useState("");
  const [aboveId, setAboveId] = useState("");
  const [belowId, setBelowId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<{ templateId: string; templateName: string }[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 직급 추가 폼을 처음 열 때 권한 템플릿 목록을 1회 로드한다(rbac.template.manage 권한 없으면 빈 목록 → '선택 안 함'만).
  useEffect(() => {
    if (!addOpen || templates.length > 0) return;
    let alive = true;
    fetch("/api/admin/permissions", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: { templateId: string; templateName: string }[] }) => {
        if (alive) {
          setTemplates(
            (d.templates ?? []).map((t) => ({ templateId: t.templateId, templateName: t.templateName }))
          );
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [addOpen, templates.length]);

  const staffIndex = sortedPositions.findIndex((position) => position.positionName === "사원");
  const withAddButton = staffIndex >= 0 ? sortedPositions : [...sortedPositions];

  const rankForNewPosition = () => {
    const above = positions.find((position) => position.positionId === aboveId);
    const below = positions.find((position) => position.positionId === belowId);
    if (above && below) {
      return Math.round((above.rankOrder + below.rankOrder) / 2);
    }
    if (above) return above.rankOrder - 5;
    if (below) return below.rankOrder + 5;
    return 30;
  };

  const submitAdd = async () => {
    const name = positionName.trim();
    if (!name) return;
    await onAdd(name, rankForNewPosition(), templateId || undefined);
    setPositionName("");
    setAboveId("");
    setBelowId("");
    setTemplateId("");
    setAddOpen(false);
  };

  const renderAddButton = () => (
    <span className="inline-flex">
      <button
        type="button"
        className="cd-chip border-dashed text-[color:var(--cd-primary)]"
        style={{ borderStyle: "dashed", borderColor: "var(--cd-primary)" }}
        onClick={() => {
          setDeleteTarget(null);
          setAddOpen((prev) => !prev);
        }}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </span>
  );

  const overlay =
    mounted && (addOpen || deleteTarget)
      ? createPortal(
          <div className="cdash-vars cd-fields-white fixed inset-0 z-[9999] pointer-events-none" data-theme={theme}>
            {addOpen && (
              <div className="cd-modal absolute right-8 top-36 w-[min(18rem,calc(100vw-3rem))] p-4 pointer-events-auto">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold cd-text">직급 추가</h4>
                  <button type="button" onClick={() => setAddOpen(false)} className="cd-text-faint hover:text-[color:var(--cd-text)]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  <Field label="직급명">
                    <input className="cd-input" value={positionName} onChange={(e) => setPositionName(e.target.value)} placeholder="예: 팀장" />
                  </Field>
                  <Field label="바로 위 직급">
                    <select className="cd-select" value={aboveId} onChange={(e) => setAboveId(e.target.value)}>
                      <option value="">선택 안 함</option>
                      {sortedPositions.map((position) => (
                        <option key={position.positionId} value={position.positionId}>
                          {position.positionName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="바로 아래 직급">
                    <select className="cd-select" value={belowId} onChange={(e) => setBelowId(e.target.value)}>
                      <option value="">선택 안 함</option>
                      {sortedPositions.map((position) => (
                        <option key={position.positionId} value={position.positionId}>
                          {position.positionName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="기본 권한 템플릿">
                    <select className="cd-select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                      <option value="">선택 안 함</option>
                      {templates.map((t) => (
                        <option key={t.templateId} value={t.templateId}>
                          {t.templateName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="text-[11px] leading-snug cd-text-faint">
                    이 직급으로 계정 발급 시 자동 부여될 권한입니다. 지정하지 않으면 발급 시 권한이 비어 있습니다.
                  </p>
                  <button type="button" className="cd-btn cd-btn-primary cd-btn-block" onClick={submitAdd}>
                    추가
                  </button>
                </div>
              </div>
            )}
            {deleteTarget && (
              <div className="cd-modal absolute right-8 top-36 w-[min(16rem,calc(100vw-3rem))] p-4 pointer-events-auto">
                <p className="text-sm cd-text mb-4">
                  {deleteTarget.positionName} 직급을 삭제하시겠습니까?
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setDeleteTarget(null)}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="cd-btn cd-btn-danger cd-btn-sm"
                    onClick={async () => {
                      await onDelete(deleteTarget.positionId);
                      setDeleteTarget(null);
                    }}
                  >
                    <Trash2 className="inline h-3.5 w-3.5 mr-1" />
                    삭제
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative flex flex-wrap gap-2 pb-2">
      {withAddButton.map((position, index) => {
        const active = activeIds.includes(position.positionId);
        const shouldRenderAdd = staffIndex >= 0 && index === staffIndex;
        return (
          <span key={position.positionId} className="relative inline-flex gap-2">
            <button
              type="button"
              onClick={() => onToggle(position.positionId)}
              onContextMenu={(e) => {
                e.preventDefault();
                setAddOpen(false);
                setDeleteTarget(position);
              }}
              className={active ? "cd-chip font-normal" : "cd-chip font-normal opacity-50"}
              data-active={active}
            >
              {position.positionName}
            </button>
            {shouldRenderAdd && renderAddButton()}
          </span>
        );
      })}
      {staffIndex < 0 && renderAddButton()}
      {overlay}
    </div>
  );
}

function RepeatingSection({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold cd-text">{title}</h3>
        <button type="button" onClick={onAdd} className="cd-btn cd-btn-ghost cd-btn-sm">
          <Plus className="w-3.5 h-3.5" /> 행 추가
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function updateArray<K extends "educations" | "certifications" | "careers" | "housingSupports">(
  setEmployee: React.Dispatch<React.SetStateAction<EmployeeDetail>>,
  key: K,
  index: number,
  patch: Partial<EmployeeDetail[K][number]>
) {
  setEmployee((prev) => ({
    ...prev,
    [key]: prev[key].map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
  }));
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-t-xl cd-soft-primary px-4 py-2 text-xs font-bold flex items-center gap-2 border-b-2 border-[color:var(--cd-primary)]"
          : "rounded-t-xl px-4 py-2 text-xs font-bold cd-text-muted hover:text-[color:var(--cd-text)] flex items-center gap-2 border-b-2 border-transparent"
      }
    >
      {icon}
      {label}
    </button>
  );
}

function onlyDigits(value: string, maxLength?: number): string {
  const digits = value.replace(/\D/g, "");
  return maxLength ? digits.slice(0, maxLength) : digits;
}

function formatDateInput(value: string): string {
  const digits = onlyDigits(value, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function formatMonthInput(value: string): string {
  const digits = onlyDigits(value, 6);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

function formatResidentNo(value: string): string {
  const digits = onlyDigits(value, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

function formatPhoneNumber(value: string): string {
  const digits = onlyDigits(value, 11);
  if (digits.startsWith("02")) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, digits.length - 4)}-${digits.slice(-4)}`;
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <Field label={label}>
      <input className="cd-input" type={type} value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl cd-surface-bg border cd-border-c p-3">
      <div className="text-[10px] font-bold uppercase cd-text-faint">{label}</div>
      <div className="text-sm font-bold cd-text mt-1">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="cd-label !mb-0">{label}</span>
      {children}
    </label>
  );
}
