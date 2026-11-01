"use client";

// 관심 설정 — 계획서 §3.2. 관심 분야(프로필) 목록에서 조건·주기·수신자·다음 실행을 한눈에 보고,
// 미리보기(AI 호출 없음)·지금 생성·정기 실행 사용/중지를 한다. 발행본 읽기는 브리핑 탭이 맡는다.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { CdBadge, CdButton, CdCheckbox, CdDateInput, CdDrawer, CdEmptyState, CdInput, CdModal, CdSelect, CdTable, useCdToast } from "@/components/cdash";
import type { BriefingChannel, BriefingPreview, BriefingProfile, BriefingProfileInput, BriefingRun } from "@/lib/intel/briefing-types";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit-industries";
import { INTEL_SERVICE_LABELS, eokToWon, formatIntelAmount, intelApi, intelDate, intelSourceLabel, intelTime, jsonBody, wonToEok } from "./intelligence-client";
import { IntelligenceListInput } from "./IntelligenceListInput";

const CADENCE = { daily: "매일", every3days: "3일마다", weekly: "매주", monthly: "매월" };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const CHANNEL: Record<BriefingChannel, string> = { inbox: "사내 메일함", email: "이메일", app: "앱 알림" };
const SIGNAL_TYPES: Record<string, string> = { investment: "투자계획", expansion: "증설", new_site: "신설", other: "기타" };
const SOURCES = ["dart", "eiass", "press", "news", "gosi_eum", "gosi_me"];
const HEALTH: Record<string, { label: string; tone: "success" | "warn" | "error" }> = { fresh: { label: "정상", tone: "success" }, stale: { label: "지연", tone: "warn" }, unavailable: { label: "수집 불가", tone: "error" } };
type RecipientUser = { userId: string; name: string; email?: string | null };

function newProfile(): BriefingProfileInput {
  return { name: "", enabled: false, visibility: "private", filters: { industries: [], regions: [], signalTypes: [], companyNames: [], services: [], amountMin: null, amountMax: null, includeUnknownScale: true }, schedule: { cadence: "weekly", startDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }), time: "08:30", weekday: 1, monthDay: 1, timezone: "Asia/Seoul" }, recipients: [], reportLevel: "summary", notifyNoChange: false, allowPartialSources: true, requiredSources: [], importantAlerts: false, importantAmount: null };
}

/** 조건군 사이는 AND, 같은 조건 안은 OR — 화면에 그대로 읽히게 요약한다. */
export function conditionSummary(input: BriefingProfileInput): string[] {
  const f = input.filters;
  const industry = (id: string) => INTEGRATED_PERMIT_INDUSTRIES.find((item) => item.id === id)?.label ?? id;
  const parts: string[] = [];
  parts.push(f.industries.length ? `업종 ${f.industries.map(industry).join("·")}` : "전체 업종");
  if (f.regions.length) parts.push(`지역 ${f.regions.join("·")}`);
  if (f.companyNames.length) parts.push(`기업 ${f.companyNames.join("·")}`);
  if (f.signalTypes.length) parts.push(f.signalTypes.map((type) => SIGNAL_TYPES[type] ?? type).join("·"));
  if (f.services.length) parts.push(`서비스 ${f.services.map((code) => INTEL_SERVICE_LABELS[code] ?? code).join("·")}`);
  if (f.amountMin != null || f.amountMax != null) parts.push(`${f.amountMin != null ? formatIntelAmount(f.amountMin) : ""} ~ ${f.amountMax != null ? formatIntelAmount(f.amountMax) : ""}${f.includeUnknownScale ? " (규모 미상 포함)" : ""}`);
  return parts;
}

function scheduleText(profile: BriefingProfileInput): string {
  const s = profile.schedule;
  const when = s.cadence === "weekly" ? `${WEEKDAYS[s.weekday]}요일` : s.cadence === "monthly" ? `${s.monthDay}일` : "";
  return `${CADENCE[s.cadence]}${when ? ` ${when}` : ""} ${s.time}`;
}

export function ScheduledBriefingPanel({ canEdit, onOpenRun }: { canEdit: boolean; onOpenRun: (runId: string) => void }) {
  const { data: session } = useSession();
  const { toast } = useCdToast();
  const [profiles, setProfiles] = useState<BriefingProfile[]>([]);
  const [users, setUsers] = useState<RecipientUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<BriefingProfile | "new" | null>(null);
  const [form, setForm] = useState<BriefingProfileInput>(newProfile);
  const [amountText, setAmountText] = useState({ min: "", max: "", important: "" });
  const [formError, setFormError] = useState("");
  const [preview, setPreview] = useState<{ profile: BriefingProfile; data: BriefingPreview } | null>(null);
  const requestKey = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try { setProfiles((await intelApi<{ profiles: BriefingProfile[] }>("/api/sales/rag/profiles")).profiles); setError(""); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { void intelApi<{ users: RecipientUser[] }>("/api/sales/rag/profiles/recipients").then((result) => setUsers(result.users)).catch(() => {}); }, []);

  function beginEdit(profile: BriefingProfile | "new") {
    const next = profile === "new" ? { ...newProfile(), recipients: session?.user?.id ? [{ userId: session.user.id, channels: ["inbox"] as BriefingChannel[] }] : [] } : structuredClone(profile);
    setEdit(profile); setForm(next); setFormError("");
    setAmountText({ min: wonToEok(next.filters.amountMin), max: wonToEok(next.filters.amountMax), important: wonToEok(next.importantAmount) });
  }
  async function save() {
    if (!edit) return;
    setBusy("save"); setFormError("");
    try {
      const payload = { ...form, filters: { ...form.filters, amountMin: eokToWon(amountText.min), amountMax: eokToWon(amountText.max) }, importantAmount: form.importantAlerts ? eokToWon(amountText.important) : null };
      await intelApi<{ profile: BriefingProfile }>(`/api/sales/rag/profiles${edit === "new" ? "" : `/${edit.profileId}`}`, { method: edit === "new" ? "POST" : "PATCH", ...jsonBody({ ...payload, ...(edit === "new" ? {} : { version: edit.version, updatedAt: edit.updatedAt }) }) });
      setEdit(null); toast("관심 분야를 저장했습니다.", "success"); await reload();
    } catch (e) { setFormError((e as Error).message); } finally { setBusy(null); }
  }
  async function toggle(profile: BriefingProfile) {
    setBusy(profile.profileId); setError("");
    try {
      await intelApi(`/api/sales/rag/profiles/${profile.profileId}`, { method: "PATCH", ...jsonBody({ ...profile, enabled: !profile.enabled, version: profile.version, updatedAt: profile.updatedAt }) });
      toast(profile.enabled ? "정기 실행을 중지했습니다." : "정기 실행을 시작했습니다.", "success"); await reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function showPreview(profile: BriefingProfile) {
    setBusy(profile.profileId); setError("");
    try { setPreview({ profile, data: (await intelApi<{ preview: BriefingPreview }>(`/api/sales/rag/profiles/${profile.profileId}/preview`, { method: "POST" })).preview }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function runNow(profile: BriefingProfile) {
    setBusy(profile.profileId); setError("");
    try {
      requestKey.current ??= crypto.randomUUID();
      const result = await intelApi<{ run: BriefingRun }>(`/api/sales/rag/profiles/${profile.profileId}/run`, { method: "POST", ...jsonBody({ requestKey: requestKey.current }) });
      requestKey.current = null; toast("브리핑 생성을 예약했습니다. 브리핑 탭에서 작성 상태를 확인합니다.", "success"); onOpenRun(result.run.runId);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  const setFilter = (key: keyof BriefingProfileInput["filters"], value: unknown) => setForm((old) => ({ ...old, filters: { ...old.filters, [key]: value } }));
  const toggleList = (key: "industries" | "signalTypes" | "services", value: string) => setFilter(key, form.filters[key].includes(value) ? form.filters[key].filter((item) => item !== value) : [...form.filters[key], value]);
  const userName = (id: string) => users.find((user) => user.userId === id)?.name ?? "알 수 없는 사용자";

  return (
    <div className="intel-stack">
      {error && <div role="alert" className="intel-error">{error}</div>}
      <section className="cd-card">
        <div className="intel-card-head">
          <div><h2 className="intel-section">관심 분야</h2><span className="intel-table cd-text-muted">{profiles.length}개</span></div>
          {canEdit && <CdButton variant="primary" onClick={() => beginEdit("new")}>관심 분야 추가</CdButton>}
        </div>
        {!loading && !profiles.length ? (
          <div className="intel-card-body"><CdEmptyState title="등록된 관심 분야가 없습니다." /></div>
        ) : (
          <CdTable bare loading={loading} rows={profiles} rowKey={(profile) => profile.profileId} columns={[
            { key: "name", header: "관심 분야 · 조건", render: (profile) => <><p className="font-medium">{profile.name}</p><p className="intel-table cd-text-muted">{conditionSummary(profile).join(" · ")}</p></> },
            { key: "schedule", header: "주기 · 다음 실행", render: (profile) => <><p>{scheduleText(profile)}</p><p className="intel-table cd-text-muted">{profile.enabled ? `다음 ${intelTime(profile.nextRunAt)}` : "정기 실행 중지"}</p></> },
            { key: "recipients", header: "수신자", widthClass: "w-40", render: (profile) => <><p>{profile.recipients.length ? `${profile.recipients.length}명` : "없음"}</p><p className="intel-table cd-text-muted">{profile.visibility === "private" ? "개인" : "지정 수신자 공유"} · {profile.reportLevel === "detailed" ? "상세" : "핵심 요약"}</p></> },
            { key: "status", header: "정기 실행", widthClass: "w-28", render: (profile) => profile.enabled ? <CdBadge tone="success">사용</CdBadge> : <CdBadge tone="idle">중지</CdBadge> },
            { key: "actions", header: "", align: "right", render: (profile) => (
              <div className="flex justify-end gap-2 flex-wrap">
                <CdButton size="sm" variant="ghost" disabled={busy === profile.profileId} onClick={() => void showPreview(profile)}>미리보기</CdButton>
                {canEdit && profile.canManage && <>
                  <CdButton size="sm" variant="ghost" disabled={busy === profile.profileId} onClick={() => void toggle(profile)}>{profile.enabled ? "일시중지" : "재개"}</CdButton>
                  <CdButton size="sm" variant="ghost" onClick={() => beginEdit(profile)}>수정</CdButton>
                  <CdButton size="sm" disabled={busy === profile.profileId} onClick={() => void runNow(profile)}>지금 생성</CdButton>
                </>}
              </div>
            ) },
          ]} />
        )}
        <p className="intel-table cd-text-muted intel-card-foot">미리보기는 AI를 호출하지 않습니다. 지금 생성과 정기 실행은 AI 사용량이 기록되며, 직전 발행 이후 변동이 없으면 보고서를 만들지 않습니다.</p>
      </section>

      <CdModal open={edit !== null} onClose={() => busy !== "save" && setEdit(null)} title={edit === "new" ? "관심 분야 추가" : "관심 분야 수정"} size="xl" closeOnBackdrop={false} footer={<><CdButton disabled={busy === "save"} onClick={() => setEdit(null)}>취소</CdButton><CdButton variant="primary" disabled={busy === "save"} onClick={() => void save()}>{busy === "save" ? "저장 중…" : "저장"}</CdButton></>}>
        <div className="intel-ui"><form className="intel-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {formError && <div className="intel-error" role="alert">{formError}</div>}
          <CdInput label="관심 분야 이름" required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="예: 충청권 반도체 투자 동향" />
          <p className="intel-notice intel-compact">적용 조건: {conditionSummary(form).join(" · ")}<span className="block cd-text-muted">서로 다른 조건은 모두 만족(AND), 같은 조건 안의 여러 값은 하나만 만족(OR)하면 포함합니다.</span></p>

          <fieldset><legend className="intel-section mb-3">관심 조건</legend>
            <div>
              <p className="intel-field-label">관심 업종 · {form.filters.industries.length ? `${form.filters.industries.length}개 선택` : "선택하지 않으면 전체"}</p>
              <div className="intel-chips">{INTEGRATED_PERMIT_INDUSTRIES.map((industry) => <button type="button" key={industry.id} className="intel-chip" aria-pressed={form.filters.industries.includes(industry.id)} onClick={() => toggleList("industries", industry.id)}>{industry.label}</button>)}</div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <IntelligenceListInput label="지역 (쉼표 구분)" placeholder="충청남도, 충청북도" value={form.filters.regions} onChange={(values) => setFilter("regions", values)} />
              <IntelligenceListInput label="관심 기업 (쉼표 구분)" placeholder="삼성전자, SK하이닉스" value={form.filters.companyNames} onChange={(values) => setFilter("companyNames", values)} />
              <CdInput label="최소 투자 규모 (억원)" inputMode="decimal" type="number" min={0} step="any" value={amountText.min} onChange={(event) => setAmountText({ ...amountText, min: event.target.value })} />
              <CdInput label="최대 투자 규모 (억원)" inputMode="decimal" type="number" min={0} step="any" value={amountText.max} onChange={(event) => setAmountText({ ...amountText, max: event.target.value })} />
            </div>
            <CdCheckbox label="투자 규모가 확인되지 않은 정보도 포함" checked={form.filters.includeUnknownScale} onChange={(event) => setFilter("includeUnknownScale", event.target.checked)} />
            <div>
              <p className="intel-field-label">정보 유형 · 선택하지 않으면 전체</p>
              <div className="intel-chips">{Object.entries(SIGNAL_TYPES).map(([key, label]) => <button type="button" key={key} className="intel-chip" aria-pressed={form.filters.signalTypes.includes(key)} onClick={() => toggleList("signalTypes", key)}>{label}</button>)}</div>
            </div>
            <div>
              <p className="intel-field-label">관심 서비스 · 공개 근거로 검토 가능한 프로젝트만 포함</p>
              <div className="intel-chips">{Object.entries(INTEL_SERVICE_LABELS).map(([key, label]) => <button type="button" key={key} className="intel-chip" aria-pressed={form.filters.services.includes(key)} onClick={() => toggleList("services", key)}>{label}</button>)}</div>
            </div>
          </fieldset>

          <fieldset><legend className="intel-section mb-3 mt-4">일정과 보고서</legend>
            <div className="grid sm:grid-cols-2 gap-4">
              <CdSelect label="생성 주기" value={form.schedule.cadence} onChange={(event) => setForm({ ...form, schedule: { ...form.schedule, cadence: event.target.value as BriefingProfileInput["schedule"]["cadence"] } })}>{Object.entries(CADENCE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</CdSelect>
              <CdInput label="생성 시작 시각 (KST)" type="time" value={form.schedule.time} onChange={(event) => setForm({ ...form, schedule: { ...form.schedule, time: event.target.value } })} />
              <CdDateInput label="시작일" required value={form.schedule.startDate} onChange={(value) => setForm({ ...form, schedule: { ...form.schedule, startDate: value } })} />
              {form.schedule.cadence === "weekly" && <CdSelect label="요일" value={form.schedule.weekday} onChange={(event) => setForm({ ...form, schedule: { ...form.schedule, weekday: Number(event.target.value) } })}>{WEEKDAYS.map((label, value) => <option value={value} key={value}>{label}요일</option>)}</CdSelect>}
              {form.schedule.cadence === "monthly" && <CdInput label="매월 일자 (없는 날은 그 달 말일)" type="number" min={1} max={31} value={form.schedule.monthDay} onChange={(event) => setForm({ ...form, schedule: { ...form.schedule, monthDay: Number(event.target.value) } })} />}
              <CdSelect label="보고서 분량" value={form.reportLevel} onChange={(event) => setForm({ ...form, reportLevel: event.target.value as "summary" | "detailed" })}><option value="summary">핵심 요약</option><option value="detailed">상세 보고서</option></CdSelect>
              <CdSelect label="공개 범위" value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value as "private" | "shared" })}><option value="private">개인</option><option value="shared">지정 수신자 공유</option></CdSelect>
            </div>
            <CdCheckbox label="정기 실행 사용" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
            <CdCheckbox label="변동이 없어도 알림 받기" checked={form.notifyNoChange} onChange={(event) => setForm({ ...form, notifyNoChange: event.target.checked })} />
            <CdCheckbox label="일부 정보원 수집이 늦어도 확인된 자료로 작성" checked={form.allowPartialSources} onChange={(event) => setForm({ ...form, allowPartialSources: event.target.checked })} />
            {!form.allowPartialSources || form.requiredSources.length ? <div>
              <p className="intel-field-label">반드시 갱신돼야 하는 정보원</p>
              <div className="intel-chips">{SOURCES.map((source) => <button type="button" key={source} className="intel-chip" aria-pressed={form.requiredSources.includes(source)} onClick={() => setForm({ ...form, requiredSources: form.requiredSources.includes(source) ? form.requiredSources.filter((value) => value !== source) : [...form.requiredSources, source] })}>{intelSourceLabel(source)}</button>)}</div>
            </div> : null}
            <CdCheckbox label="중요 변화 즉시 알림 (단계 진전·지연·취소·정정, 기준 금액 이상의 투자)" checked={form.importantAlerts} onChange={(event) => setForm({ ...form, importantAlerts: event.target.checked })} />
            {form.importantAlerts && <CdInput label="중요 투자금액 기준 (억원)" type="number" min={0} step="any" value={amountText.important} onChange={(event) => setAmountText({ ...amountText, important: event.target.value })} />}
          </fieldset>

          <fieldset><legend className="intel-section mb-3 mt-4">수신자</legend>
            <p className="intel-table cd-text-muted">사내 메일함은 기본으로 전달됩니다. 이메일·앱 알림을 고르면 사내 메일함도 함께 켜집니다.</p>
            <CdTable bare rows={form.visibility === "private" ? users.filter((user) => user.userId === session?.user?.id) : users} rowKey={(user) => user.userId} columns={[
              { key: "name", header: "이름", render: (user) => user.name },
              ...(["inbox", "email", "app"] as BriefingChannel[]).map((channel) => ({ key: channel, header: CHANNEL[channel], render: (user: RecipientUser) => <CdCheckbox aria-label={`${user.name} ${CHANNEL[channel]}`} disabled={channel === "inbox" && user.userId === session?.user?.id} checked={form.recipients.find((recipient) => recipient.userId === user.userId)?.channels.includes(channel) ?? false} onChange={(event) => {
                const previous = form.recipients.find((recipient) => recipient.userId === user.userId)?.channels ?? [];
                const channels: BriefingChannel[] = event.target.checked ? [...new Set<BriefingChannel>([...previous, "inbox", channel])] : channel === "inbox" ? [] : previous.filter((value) => value !== channel);
                setForm({ ...form, recipients: [...form.recipients.filter((recipient) => recipient.userId !== user.userId), ...(channels.length ? [{ userId: user.userId, channels }] : [])] });
              }} /> })),
            ]} />
          </fieldset>
        </form></div>
      </CdModal>

      <CdDrawer open={preview !== null} onClose={() => setPreview(null)} title={preview ? `${preview.profile.name} · 미리보기` : "미리보기"} widthClass="max-w-3xl">
        {preview && <div className="intel-ui intel-stack">
          <dl className="intel-dl">
            <dt>적용 조건</dt><dd>{conditionSummary(preview.profile).join(" · ")}</dd>
            <dt>주기</dt><dd>{scheduleText(preview.profile)} KST</dd>
            <dt>다음 실행</dt><dd>{preview.profile.enabled ? intelTime(preview.profile.nextRunAt) : "정기 실행 중지"}</dd>
            <dt>수신자</dt><dd>{preview.profile.recipients.length ? preview.profile.recipients.map((recipient) => `${userName(recipient.userId)}(${recipient.channels.map((channel) => CHANNEL[channel]).join("·")})`).join(", ") : "없음"}</dd>
            {preview.data.periodStart && <><dt>분석 기간</dt><dd>{intelDate(preview.data.periodStart)} ~ {intelDate(preview.data.periodEnd ?? preview.data.asOf)}</dd></>}
          </dl>
          <div className="intel-stat-strip border rounded-lg cd-border-c">
            <div className="intel-stat"><span className="intel-table cd-text-muted">대상 프로젝트</span><strong>{preview.data.totalProjects.toLocaleString()}</strong></div>
            <div className="intel-stat"><span className="intel-table cd-text-muted">관련 신호</span><strong>{preview.data.totalSignals.toLocaleString()}</strong></div>
            <div className="intel-stat"><span className="intel-table cd-text-muted">직전 이후 변경</span><strong>{preview.data.changedCount.toLocaleString()}</strong></div>
          </div>
          {preview.data.initialBaseline && <p className="intel-notice intel-compact">첫 보고서는 기존 자료 초기 분석으로 작성합니다.</p>}
          {preview.data.coverageNote && <p className="intel-prose cd-text-muted">{preview.data.coverageNote}</p>}
          <section>
            <h3 className="intel-section mb-3">정보원 수집 상태</h3>
            <CdTable bare rows={preview.data.sourceHealth} rowKey={(source) => source.source} columns={[
              { key: "source", header: "정보원", render: (source) => intelSourceLabel(source.source) },
              { key: "status", header: "상태", widthClass: "w-28", render: (source) => <CdBadge tone={HEALTH[source.status]?.tone ?? "idle"}>{HEALTH[source.status]?.label ?? source.status}</CdBadge> },
              { key: "last", header: "최근 성공", render: (source) => <span className="intel-table">{source.lastSuccessAt ? intelTime(source.lastSuccessAt) : source.message}</span> },
            ]} />
          </section>
          <section>
            <h3 className="intel-section mb-3">대표 후보 <span className="intel-table cd-text-muted font-normal">{preview.data.items.length}건</span></h3>
            <ul className="intel-rows border-b cd-border-c">{preview.data.items.slice(0, 30).map((item) => (
              <li key={`${item.kind}:${item.id}`} className="py-3 flex justify-between gap-4">
                <div className="min-w-0"><p>{item.title}</p><p className="intel-table cd-text-muted">{[item.companyName, intelSourceLabel(item.source), intelDate(item.publishedAt)].filter(Boolean).join(" · ")}</p></div>
                {item.changed && <CdBadge tone="info">새 변경</CdBadge>}
              </li>
            ))}</ul>
          </section>
        </div>}
      </CdDrawer>
    </div>
  );
}
