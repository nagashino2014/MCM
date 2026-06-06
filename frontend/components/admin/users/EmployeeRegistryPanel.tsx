"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type React from "react";
import { BriefcaseBusiness, FileUp, GraduationCap, Home, Plus, Save, Trash2, UserRoundCog, X } from "lucide-react";
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

type TabKey = "basic" | "education" | "evidence";

interface EmployeeDetail {
  employeeId?: string;
  userId?: string | null;
  employeeNo?: string | null;
  name: string;
  deptId?: string | null;
  positionId?: string | null;
  hiredAt?: string | null;
  jobDuties?: string | null;
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
}

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

  const addPosition = async (positionName: string, rankOrder: number) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/organization/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ positionName, rankOrder }),
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

  const uploadDocument = async (file: File, documentType: string, displayName: string) => {
    if (!employee.employeeId) {
      toast("직원 정보를 먼저 저장한 뒤 파일을 업로드하세요.", "error");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("employeeId", employee.employeeId);
    form.set("documentType", documentType);
    form.set("displayName", displayName);
    form.set("targetTable", "employee_profiles");
    const res = await fetch("/api/admin/employee-documents", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "업로드 실패");
    const body = (await res.json()) as { document: DocumentRow };
    setEmployee((prev) => ({ ...prev, documents: [body.document, ...prev.documents] }));
    toast("증빙 파일이 업로드되었습니다.");
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="glass-panel rounded-3xl p-6 reveal delay-1">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">Department</p>
            <h2 className="text-2xl font-black text-stone-800">부서 편집</h2>
            <p className="text-sm text-stone-500 mt-1">상위 부서와 해당 부서에서 사용할 직급을 설정합니다.</p>
          </div>
          <BriefcaseBusiness className="w-7 h-7 text-primary" fill="currentColor" />
        </div>
        <div className="grid lg:grid-cols-[1fr_0.8fr] gap-4">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="부서명">
              <input className="input-field" value={departmentDraft.deptName} onChange={(e) => setDepartmentDraft((prev) => ({ ...prev, deptName: e.target.value }))} placeholder="부서명" />
            </Field>
            <Field label="부서 유형">
              <select className="ui-select" value={departmentDraft.deptKind} onChange={(e) => setDepartmentDraft((prev) => ({ ...prev, deptKind: e.target.value }))}>
                <option value="executive">총괄</option>
                <option value="division">본부</option>
                <option value="team">팀</option>
                <option value="lab">연구소</option>
                <option value="branch">지사</option>
                <option value="support">지원</option>
              </select>
            </Field>
            <Field label="상위 부서">
              <select className="ui-select" value={departmentDraft.parentDeptId} onChange={(e) => setDepartmentDraft((prev) => ({ ...prev, parentDeptId: e.target.value }))}>
                <option value="">최상위 부서</option>
                {departments.filter((dept) => dept.deptId !== selectedDept?.deptId).map((dept) => (
                  <option key={dept.deptId} value={dept.deptId}>
                    {dept.deptName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="표시 색상">
              <input className="input-field h-10" type="color" value={departmentDraft.accentColor} onChange={(e) => setDepartmentDraft((prev) => ({ ...prev, accentColor: e.target.value }))} />
            </Field>
          </div>
          <div className="rounded-2xl bg-white/55 border border-white/70 p-4">
            <h3 className="font-medium text-stone-800 mb-3">사용 가능 직급</h3>
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
            <button type="button" disabled={saving || !departmentDraft.deptName} onClick={saveDepartment} className="mt-4 rounded-xl px-4 py-2 text-xs font-bold text-white bg-primary disabled:opacity-40">
              부서 저장
            </button>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-3xl p-6 reveal delay-2">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">Employee record</p>
            <h2 className="text-2xl font-black text-stone-800">사용자 등록·수정</h2>
          </div>
          <button type="button" className="glass-button rounded-xl px-3 py-2 text-xs font-bold" onClick={() => setEmployee(emptyEmployee(selectedDept?.deptId))}>
            신규 등록
          </button>
        </div>
        <div className="flex gap-2 border-b border-stone-200 mb-5">
          <TabButton active={activeTab === "basic"} onClick={() => setActiveTab("basic")} icon={<UserRoundCog className="w-4 h-4" />} label="기본 정보" />
          <TabButton active={activeTab === "education"} onClick={() => setActiveTab("education")} icon={<GraduationCap className="w-4 h-4" />} label="학력/자격" />
          <TabButton active={activeTab === "evidence"} onClick={() => setActiveTab("evidence")} icon={<Home className="w-4 h-4" />} label="기타 증빙" />
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

        <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-stone-200">
          <div className="text-xs text-stone-500">
            주민번호는 서버에서 암호화 저장하며 화면에는 마스킹 값과 생년월일/성별만 표시합니다.
          </div>
          <button type="button" disabled={saving || !employee.name} onClick={saveEmployee} className="rounded-xl px-5 py-2.5 text-xs font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-40 flex items-center gap-2">
            <Save className="w-4 h-4" /> 직원 정보 저장
          </button>
        </div>
      </section>
    </div>
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
      <TextField label="성명" value={employee.name} onChange={(value) => setEmployee((prev) => ({ ...prev, name: value }))} />
      <Field label="직급">
        <select className="ui-select" value={employee.positionId ?? ""} onChange={(e) => setEmployee((prev) => ({ ...prev, positionId: e.target.value || null }))}>
          <option value="">직급 선택</option>
          {positions.map((position) => (
            <option key={position.positionId} value={position.positionId}>
              {position.positionName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="부서">
        <select className="ui-select" value={employee.deptId ?? ""} onChange={(e) => setEmployee((prev) => ({ ...prev, deptId: e.target.value || null, positionId: null }))}>
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
      <label className="md:col-span-3 flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase text-stone-500">거주지 주소</span>
        <input className="input-field" value={employee.address ?? ""} onChange={(e) => setEmployee((prev) => ({ ...prev, address: e.target.value }))} />
      </label>
      <div className="md:col-span-3 grid md:grid-cols-3 gap-3">
        <InfoPill label="마스킹 주민번호" value={employee.residentRegistrationMasked ?? "저장 후 표시"} />
        <InfoPill label="생년월일" value={employee.birthDate ?? "자동 분류"} />
        <InfoPill label="성별" value={employee.gender === "male" ? "남성" : employee.gender === "female" ? "여성" : "자동 분류"} />
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
  uploadDocument: (file: File, documentType: string, displayName: string) => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <RepeatingSection
        title="학력 정보"
        onAdd={() => setEmployee((prev) => ({ ...prev, educations: [...prev.educations, { degreeLevel: "bachelor", schoolName: "" }] }))}
      >
        {employee.educations.map((item, index) => (
          <div key={index} className="grid md:grid-cols-6 gap-2 rounded-2xl bg-white/55 border border-white/70 p-3">
            <select className="ui-select" value={item.degreeLevel} onChange={(e) => updateArray(setEmployee, "educations", index, { degreeLevel: e.target.value as EducationRow["degreeLevel"] })}>
              <option value="bachelor">학사</option>
              <option value="master">석사</option>
              <option value="doctor">박사</option>
            </select>
            <input className="input-field" placeholder="출신 학교" value={item.schoolName} onChange={(e) => updateArray(setEmployee, "educations", index, { schoolName: e.target.value })} />
            <input className="input-field" placeholder="전공" value={item.major ?? ""} onChange={(e) => updateArray(setEmployee, "educations", index, { major: e.target.value })} />
            <input className="input-field" placeholder="학위" value={item.degreeName ?? ""} onChange={(e) => updateArray(setEmployee, "educations", index, { degreeName: e.target.value })} />
            <input className="input-field" inputMode="numeric" placeholder="입학일" value={item.admissionDate ?? ""} onChange={(e) => updateArray(setEmployee, "educations", index, { admissionDate: formatDateInput(e.target.value) })} />
            <input className="input-field" inputMode="numeric" placeholder="졸업일" value={item.graduationDate ?? ""} onChange={(e) => updateArray(setEmployee, "educations", index, { graduationDate: formatDateInput(e.target.value) })} />
          </div>
        ))}
      </RepeatingSection>

      <RepeatingSection
        title="자격증"
        onAdd={() => setEmployee((prev) => ({ ...prev, certifications: [...prev.certifications, { certificationName: CERTIFICATION_OPTIONS[0] }] }))}
      >
        {employee.certifications.map((item, index) => (
          <div key={index} className="grid md:grid-cols-4 gap-2 rounded-2xl bg-white/55 border border-white/70 p-3">
            <select className="ui-select" value={item.certificationName} onChange={(e) => updateArray(setEmployee, "certifications", index, { certificationName: e.target.value })}>
              {CERTIFICATION_OPTIONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <input className="input-field" type="date" value={item.passedAt ?? ""} onChange={(e) => updateArray(setEmployee, "certifications", index, { passedAt: e.target.value })} />
            <input className="input-field" type="date" value={item.issuedAt ?? ""} onChange={(e) => updateArray(setEmployee, "certifications", index, { issuedAt: e.target.value })} />
            <input className="input-field" placeholder="자격번호" value={item.certificationNo ?? ""} onChange={(e) => updateArray(setEmployee, "certifications", index, { certificationNo: e.target.value })} />
          </div>
        ))}
      </RepeatingSection>

      <UploadRow uploadDocument={uploadDocument} types={["졸업증명서", "성적증명서", "학위증명서", "자격증 사본"]} documents={employee.documents} />
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
  uploadDocument: (file: File, documentType: string, displayName: string) => Promise<void>;
}) {
  return (
    <div className="space-y-5">
      <RepeatingSection
        title="전근무지 근무 이력"
        onAdd={() => setEmployee((prev) => ({ ...prev, careers: [...prev.careers, {}] }))}
      >
        {employee.careers.map((item, index) => (
          <div key={index} className="grid md:grid-cols-5 gap-2 rounded-2xl bg-white/55 border border-white/70 p-3">
            <input className="input-field" inputMode="numeric" placeholder="입사시기" value={item.workedFrom ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { workedFrom: formatMonthInput(e.target.value) })} />
            <input className="input-field" inputMode="numeric" placeholder="퇴사시기" value={item.workedTo ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { workedTo: formatMonthInput(e.target.value) })} />
            <input className="input-field" placeholder="근무처" value={item.companyName ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { companyName: e.target.value })} />
            <input className="input-field" placeholder="최종직위" value={item.finalPosition ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { finalPosition: e.target.value })} />
            <input className="input-field" placeholder="담당업무" value={item.responsibilities ?? ""} onChange={(e) => updateArray(setEmployee, "careers", index, { responsibilities: e.target.value })} />
          </div>
        ))}
      </RepeatingSection>

      <RepeatingSection
        title="주거비 지원 임대차 계약"
        onAdd={() => setEmployee((prev) => ({ ...prev, housingSupports: [...prev.housingSupports, {}] }))}
      >
        {employee.housingSupports.map((item, index) => (
          <div key={index} className="grid md:grid-cols-5 gap-2 rounded-2xl bg-white/55 border border-white/70 p-3">
            <input className="input-field" type="date" value={item.leaseStartedAt ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { leaseStartedAt: e.target.value })} />
            <input className="input-field" type="date" value={item.leaseEndedAt ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { leaseEndedAt: e.target.value })} />
            <input className="input-field" type="number" placeholder="월세액" value={item.monthlyRent ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { monthlyRent: Number(e.target.value || 0) })} />
            <input className="input-field" type="number" placeholder="보증금" value={item.depositAmount ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { depositAmount: Number(e.target.value || 0) })} />
            <input className="input-field" placeholder="임대차 주소" value={item.address ?? ""} onChange={(e) => updateArray(setEmployee, "housingSupports", index, { address: e.target.value })} />
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
  uploadDocument: (file: File, documentType: string, displayName: string) => Promise<void>;
  types: string[];
  documents: DocumentRow[];
}) {
  const [documentType, setDocumentType] = useState(types[0]);
  return (
    <div className="rounded-2xl bg-white/55 border border-white/70 p-4">
      <h3 className="mb-3 text-sm font-medium text-stone-800">증빙 서류 업로드</h3>
      <div className="grid md:grid-cols-[220px_1fr] gap-3 items-center">
        <select className="ui-select" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <label className="glass-button rounded-xl px-3 py-2 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer">
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
            <a key={doc.documentId} href={doc.publicPath ?? "#"} className="rounded-full bg-stone-900 text-white px-3 py-1 text-[11px] font-bold" target="_blank" rel="noreferrer">
              {doc.originalFilename || doc.displayName}
            </a>
          ))}
      </div>
    </div>
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
  onAdd: (positionName: string, rankOrder: number) => Promise<void>;
  onDelete: (positionId: string) => Promise<void>;
}) {
  const sortedPositions = [...positions].sort((a, b) => b.rankOrder - a.rankOrder);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PositionRow | null>(null);
  const [positionName, setPositionName] = useState("");
  const [aboveId, setAboveId] = useState("");
  const [belowId, setBelowId] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    await onAdd(name, rankForNewPosition());
    setPositionName("");
    setAboveId("");
    setBelowId("");
    setAddOpen(false);
  };

  const renderAddButton = () => (
    <span className="inline-flex">
      <button
        type="button"
        className="ui-chip border-dashed text-primary"
        data-active={true}
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
          <div className="fixed inset-0 z-[9999] pointer-events-none">
            {addOpen && (
              <div className="absolute right-8 top-36 w-[min(18rem,calc(100vw-3rem))] rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl pointer-events-auto">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-stone-800">직급 추가</h4>
                  <button type="button" onClick={() => setAddOpen(false)} className="text-stone-400 hover:text-stone-700">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  <Field label="직급명">
                    <input className="input-field" value={positionName} onChange={(e) => setPositionName(e.target.value)} placeholder="예: 팀장" />
                  </Field>
                  <Field label="바로 위 직급">
                    <select className="ui-select" value={aboveId} onChange={(e) => setAboveId(e.target.value)}>
                      <option value="">선택 안 함</option>
                      {sortedPositions.map((position) => (
                        <option key={position.positionId} value={position.positionId}>
                          {position.positionName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="바로 아래 직급">
                    <select className="ui-select" value={belowId} onChange={(e) => setBelowId(e.target.value)}>
                      <option value="">선택 안 함</option>
                      {sortedPositions.map((position) => (
                        <option key={position.positionId} value={position.positionId}>
                          {position.positionName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button type="button" className="w-full rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white" onClick={submitAdd}>
                    추가
                  </button>
                </div>
              </div>
            )}
            {deleteTarget && (
              <div className="absolute right-8 top-36 w-[min(16rem,calc(100vw-3rem))] rounded-2xl border border-rose-100 bg-white p-4 shadow-2xl pointer-events-auto">
                <p className="text-sm text-stone-700 mb-4">
                  {deleteTarget.positionName} 직급을 삭제하시겠습니까?
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="glass-button rounded-xl px-3 py-2 text-xs font-bold" onClick={() => setDeleteTarget(null)}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-rose-500 px-3 py-2 text-xs font-bold text-white"
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
              className={active ? "ui-chip font-normal" : "ui-chip font-normal opacity-50"}
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
        <h3 className="font-medium text-stone-800">{title}</h3>
        <button type="button" onClick={onAdd} className="glass-button rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-1">
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
    <button type="button" onClick={onClick} className={active ? "rounded-t-xl bg-primary text-white px-4 py-2 text-xs font-black flex items-center gap-2" : "rounded-t-xl px-4 py-2 text-xs font-black text-stone-500 hover:bg-white/60 flex items-center gap-2"}>
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
      <input className="input-field" type={type} value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-stone-50 border border-stone-100 p-3">
      <div className="text-[10px] font-black uppercase text-stone-400">{label}</div>
      <div className="text-sm font-bold text-stone-700 mt-1">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase text-stone-500">{label}</span>
      {children}
    </label>
  );
}
