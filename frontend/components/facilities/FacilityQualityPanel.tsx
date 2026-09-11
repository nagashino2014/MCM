"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardList, RefreshCw, Search, Check, Undo2, Download, ExternalLink } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { FIELDS, LABELS, type Field, type Diagnosis, type Snapshot } from "@scraper/lib/facility-quality/rules";
import "@/components/cdash/cdash.css";

const labels: Record<string, string> = { valid:"정상",missing:"공란",format:"형식 수정",review:"값 확인",conflict:"출처 충돌",not_applicable:"해당 없음",pending:"대기",queued:"실행 대기",running:"진행 중",completed:"완료",needs_attention:"확인 필요",historical:"과거 사업장",interrupted:"중단",failed:"실패",applied:"반영됨",reverted:"복원됨",rejected:"제외됨",stale_conflict:"수정 충돌",blocked:"접근·식별 제한",not_found:"검색 결과 없음",not_exposed:"항목 미노출",not_configured:"인증 미설정",parse_error:"구조 확인 필요",quota:"조회 한도",timeout:"시간 초과",error:"조회 실패",success:"조회 완료" };
const sourceNames: Record<string,string> = { format:"표기 정리",naver:"네이버 기업정보",nice:"NICE",dart:"DART",fsc:"금융위원회",bizno:"비즈노",ingestion:"재수집 충돌" };
type Run = {run_id:string;mode:string;status:string;created_at:string;error?:string};
type Entry = { candidate_id?:string;facility_id:string;field:Field;value:string;old_value:string|null;source:string;source_url:string|null;status:string;recommended:boolean;match_level:string;snapshot:Snapshot;diagnosis:Record<Field,Diagnosis>&{secondary:Record<string,Diagnosis>};evidence:{reason?:string;retrievedAt?:string;sourceDate?:string;scope?:string;name?:string;lastPublishedAt?:string;identifiers?:{brn?:string;crn?:string}};outcomes:Record<string,{status:string;note?:string}> };
type Data = {run:Run;counts:{status:string;count:number}[];fields:{field:Field;status:string;count:number}[];records:Entry[];total:number};
const date = (s?:string) => s ? /^\d{8}$/.test(s) ? `${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6)}` : new Date(s).toLocaleString("ko-KR") : "기준일 미제공";
async function api(url:string,body?:unknown,method="POST") {
  const res = await fetch(url,body ? {method,headers:{"content-type":"application/json"},body:JSON.stringify(body)} : {cache:"no-store"});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "요청을 처리하지 못했습니다");
  return data;
}
export function FacilityQualityPanel() {
  const {theme} = useCdashTheme();
  const [runs,setRuns] = useState<Run[]>([]);
  const [runId,setRunId] = useState("");
  const [data,setData] = useState<Data|null>(null);
  const [view,setView] = useState("items");
  const [field,setField] = useState("");
  const [status,setStatus] = useState("");
  const [offset,setOffset] = useState(0);
  const [selected,setSelected] = useState<Set<string>>(new Set());
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [queueEnabled,setQueueEnabled] = useState(true);
  const [sources,setSources] = useState(["naver","dart","fsc","bizno"]);
  const [scope,setScope] = useState("50");
  const [ingestion,setIngestion] = useState(false);
  const [sourceFilter,setSourceFilter] = useState("");
  const [needsAttention,setNeedsAttention] = useState(false);
  const requestId = useRef(0);
  const loadRuns = useCallback(async () => {
    const r = await api("/api/facilities/enrich"); setRuns(r.runs);setQueueEnabled(r.queueEnabled);
    setRunId(prev => prev || new URLSearchParams(location.search).get("run") || r.runs[0]?.run_id || "");
  },[]);
  const query = useCallback((page=offset) => new URLSearchParams({runId,view,field,status,offset:String(page),ingestion:String(ingestion),source:view==="candidates"?sourceFilter:"",needsAttention:String(needsAttention)}).toString(),[runId,view,field,status,offset,ingestion,sourceFilter,needsAttention]);
  const load = useCallback(async () => {
    if (!runId) return;
    const id=++requestId.current;
    try {const r=await api("/api/facilities/enrich?"+query());if(id===requestId.current){setData(r);setError("");}}
    catch(e){if(id===requestId.current)setError((e as Error).message);}
  },[runId,query]);
  useEffect(()=>{loadRuns().catch(e=>setError(e.message));},[loadRuns]);
  useEffect(()=>{setSelected(new Set());setData(null);void load();return()=>{requestId.current++;};},[load]);
  useEffect(()=>{
    if (!data || !["running","queued"].includes(data.run.status)) return;
    const timer=setInterval(()=>void load(),5000);return()=>clearInterval(timer);
  },[data?.run.status,load]);
  const act = async (fn:()=>Promise<void>) => {setBusy(true);setError("");setMessage("");try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const start = (mode:string) => act(async()=>{
    const r=await api("/api/facilities/enrich",{mode,sources, ...(mode==="enrich"&&scope!=="all"?{limit:Number(scope)}:{})});
    setRunId(r.runId);setOffset(0);setStatus("");setView("items");setQueueEnabled(r.queueEnabled);await loadRuns();
    setMessage(mode==="audit"?"전수 원본 점검을 완료했습니다. 후보 검토에서 형식 수정을 확인하세요.":"외부 조회 작업을 저장했습니다. 페이지를 닫아도 진행 상태가 남습니다.");
  });
  const review = (action:string) => act(async()=>{
    const r=await api("/api/facilities/enrich/apply",{candidateIds:[...selected],action});
    const counts:Record<string,number>={};for(const item of r.results)counts[item.status]=(counts[item.status]||0)+1;
    setMessage(Object.entries(counts).map(([s,n])=>`${labels[s]||s} ${n}건`).join(" · "));
    setSelected(new Set());await load();
  });
  const exportReport = () => act(async()=>{
    const all:Entry[]=[];for(let i=0;;i+=50){const r=await api("/api/facilities/enrich?"+query(i));all.push(...r.records);if(all.length>=r.total)break;}
    const url=URL.createObjectURL(new Blob([JSON.stringify({run:data?.run,summary:data?.fields,records:all},null,2)],{type:"application/json"}));
    const a=document.createElement("a");a.href=url;a.download=`사업장정비_${runId}_${view}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const total=data?.counts.reduce((a,b)=>a+b.count,0)||0;
  const finished=data?.counts.filter(x=>x.status!=="pending").reduce((a,b)=>a+b.count,0)||0;
  const changeFilter=(setter:(s:string)=>void,value:string)=>{setter(value);setOffset(0);};
  return <div className="cdash cd-fields-white p-4 md:p-5 flex flex-col gap-4 min-h-full rounded-3xl" data-theme={theme}>
    <CdPageHeader icon={<ClipboardList className="w-5 h-5"/>} eyebrow="Facility Data Quality" title="사업장 정보 전수 점검" help="원본을 진단하고, 출처와 변경 전후를 확인한 후보만 선택 반영합니다." actions={<Link href="/facilities" className="cd-btn cd-btn-ghost cd-btn-sm">사업장 마스터</Link>}/>
    {error&&<div role="alert" className="cd-card p-3 cd-error-text">{error}</div>}
    {message&&<div role="status" className="cd-card p-3 cd-text">{message}</div>}
    <div className="cd-card p-4 rounded-2xl flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={busy} onClick={()=>start("audit")} className="cd-btn cd-btn-primary"><ClipboardList size={16}/>전체 원본 점검</button>
        <select aria-label="외부 조회 범위" value={scope} onChange={e=>setScope(e.target.value)} className="cd-input !w-auto"><option value="50">표본 50개</option><option value="100">표본 100개</option><option value="all">전체 사업장</option></select>
        <button disabled={busy||!sources.length} onClick={()=>start("enrich")} className="cd-btn cd-btn-ghost"><Search size={16}/>외부 보완 후보 찾기</button>
        <Link href="/facilities/missing/industry" className="cd-btn cd-btn-ghost">업종 누락 점검</Link>
      </div>
      <div className="flex flex-wrap gap-4 text-sm cd-text">{Object.entries(sourceNames).filter(([s])=>["naver","dart","fsc","bizno"].includes(s)).map(([s,n])=><label key={s} className="flex gap-1 items-center"><input type="checkbox" checked={sources.includes(s)} onChange={e=>setSources(v=>e.target.checked?[...v,s]:v.filter(x=>x!==s))}/>{n}</label>)}</div>
      <p className="text-xs cd-text-faint">대표자는 네이버 기업정보 카드 우선 · 비즈노 대표자 제외 · 외부 후보 기본 미선택 · 폐업 이력이 있는 사업장은 원본 점검만 수행</p>
      {!queueEnabled&&<p className="text-sm cd-warning-text">외부 조회 워커가 연결되지 않은 환경입니다. 작업은 대기 상태로 저장되며 워커 연결 후 재개할 수 있습니다.</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="저장된 점검 작업" className="cd-input max-w-lg" value={runId} onChange={e=>{setRunId(e.target.value);setOffset(0);}}><option value="">저장된 작업 선택</option>{runs.map(r=><option key={r.run_id} value={r.run_id}>{date(r.created_at)} · {r.mode==="audit"?"원본 점검":"외부 조회"} · {labels[r.status]||r.status}</option>)}</select>
      <button disabled={busy||!runId||data?.run.status==="completed"} className="cd-btn cd-btn-ghost" onClick={()=>act(async()=>{await api("/api/facilities/enrich",{runId},"PATCH");await load();})}><RefreshCw size={15}/>미완료 재개</button>
      {data&&<span className="text-sm cd-text">{labels[data.run.status]||data.run.status} · {finished.toLocaleString()} / {total.toLocaleString()}개 사업장</span>}
    </div>
    {data?.run.error&&<p className="cd-error-text text-sm">{data.run.error}</p>}
    {data&&<div className="cd-card rounded-2xl overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="cd-table-head"><tr className="text-left cd-text-faint"><th className="p-3">항목별 원본 진단</th>{["valid","missing","format","review","conflict"].map(s=><th key={s} className="p-3">{labels[s]}</th>)}</tr></thead><tbody>{FIELDS.map(f=><tr key={f} className="border-t border-[var(--cd-line)]"><td className="p-3 cd-text">{LABELS[f]}</td>{["valid","missing","format","review","conflict"].map(s=><td key={s} className="p-3"><button className="cd-text" onClick={()=>{setView("items");setField(f);setStatus(s);setOffset(0);}}>{data.fields.find(x=>x.field===f&&x.status===s)?.count||0}</button></td>)}</tr>)}</tbody></table><p className="px-3 pb-3 text-xs cd-text-faint">실행 시작 시 원본 기준입니다. 반영 결과는 새 전수 점검으로 확인하세요. 한 사업장이 여러 항목에 포함됩니다.</p></div>}
    {runId&&<>
      <div className="flex flex-wrap gap-2 items-center">
        <button className={`cd-btn ${view==="items"?"cd-btn-primary":"cd-btn-ghost"}`} onClick={()=>{setView("items");setStatus("");setOffset(0);}}>원본 진단</button>
        <button className={`cd-btn ${view==="candidates"?"cd-btn-primary":"cd-btn-ghost"}`} onClick={()=>{setView("candidates");setStatus("pending");setOffset(0);}}>후보 검토·변경 이력</button>
        <select aria-label="항목 필터" className="cd-input !w-auto" value={field} onChange={e=>changeFilter(setField,e.target.value)}><option value="">전체 항목</option>{FIELDS.map(f=><option key={f} value={f}>{LABELS[f]}</option>)}</select>
        <select aria-label="상태 필터" className="cd-input !w-auto" value={status} onChange={e=>changeFilter(setStatus,e.target.value)}><option value="">전체 상태</option>{(view==="items"?["valid","missing","format","review","conflict"]:["pending","applied","rejected","stale_conflict","reverted"]).map(s=><option key={s} value={s}>{labels[s]}</option>)}</select>
        {view==="candidates"?<select aria-label="출처 필터" className="cd-input !w-auto" value={sourceFilter} onChange={e=>changeFilter(setSourceFilter,e.target.value)}><option value="">전체 출처</option>{Object.entries(sourceNames).map(([s,n])=><option key={s} value={s}>{n}</option>)}</select>:<label className="text-sm cd-text"><input type="checkbox" checked={needsAttention} onChange={e=>{setNeedsAttention(e.target.checked);setOffset(0);}}/> 조회 확인 필요만</label>}
        <button disabled={busy||!data} onClick={exportReport} className="cd-btn cd-btn-ghost"><Download size={15}/>현재 조건 보고서</button>
      </div>
      {view==="candidates"&&<div className="flex flex-wrap gap-2 items-center text-sm">
        <label className="cd-text"><input type="checkbox" checked={ingestion} onChange={e=>{setIngestion(e.target.checked);setOffset(0);}}/> 재수집 충돌 포함</label>
        <button className="cd-btn cd-btn-ghost" onClick={()=>setSelected(new Set(data?.records.filter(c=>c.recommended&&c.status==="pending").map(c=>c.candidate_id!)||[]))}>이 페이지 형식 수정 선택</button>
        <button disabled={busy||!selected.size} onClick={()=>review("apply")} className="cd-btn cd-btn-primary"><Check size={15}/>선택 반영 ({selected.size})</button>
        <button disabled={busy||!selected.size} onClick={()=>review("reject")} className="cd-btn cd-btn-ghost">선택 제외</button>
        <button disabled={busy||!selected.size} onClick={()=>review("revert")} className="cd-btn cd-btn-ghost"><Undo2 size={15}/>선택 복원</button>
      </div>}
      <div className="flex flex-col gap-3">{data?.records.map(entry=><article key={entry.candidate_id||entry.facility_id} className="cd-card p-4 rounded-2xl text-sm">
        <div className="flex items-center gap-2 mb-2">{entry.candidate_id&&<input aria-label={`${entry.snapshot.company_name} ${LABELS[entry.field]} 선택`} type="checkbox" disabled={busy||entry.match_level==="blocked"||!["pending","applied"].includes(entry.status)} checked={selected.has(entry.candidate_id)} onChange={e=>setSelected(v=>{const n=new Set(v);e.target.checked?n.add(entry.candidate_id!):n.delete(entry.candidate_id!);return n;})}/>}
          <Link className="font-semibold cd-text" href={`/facilities?focus=${encodeURIComponent(entry.facility_id)}`}>{entry.snapshot.company_name}</Link><span className="cd-text-faint">{labels[entry.status]||entry.status}</span>
        </div>
        {entry.candidate_id?<>
          <div className="grid gap-3 sm:grid-cols-[100px_1fr_1fr]"><strong className="cd-text">{LABELS[entry.field]}</strong><div className="cd-text-faint break-words">기존: {entry.old_value||"(공란)"}</div><div className="cd-text break-words">제안: {entry.value}</div></div>
          <div className="mt-2 cd-text-faint flex flex-wrap gap-x-4 gap-y-1"><span>{sourceNames[entry.source]||entry.source}</span><span>{entry.evidence.reason}</span>{entry.source_url&&/^https:\/\//.test(entry.source_url)&&<a className="inline-flex items-center gap-1 cd-text" href={entry.source_url} target="_blank" rel="noopener noreferrer">출처 열기<ExternalLink size={12}/></a>}</div>
          {entry.evidence.name&&<p className="mt-1 cd-text">조회된 업체: {entry.evidence.name} · {entry.evidence.scope==="headquarters"?"본사 정보":entry.evidence.scope==="site"?"사업장 정보":"적용 범위 확인 필요"}{entry.evidence.identifiers?.brn&&` · 사업자번호 ${entry.evidence.identifiers.brn}`}{entry.evidence.identifiers?.crn&&` · 법인번호 ${entry.evidence.identifiers.crn}`}</p>}
          {entry.evidence.retrievedAt&&<p className="mt-1 text-xs cd-text-faint">조회: {date(entry.evidence.retrievedAt)} · 정보 기준일: {date(entry.evidence.sourceDate)} · 조회일은 대표자 변경일이 아닙니다.</p>}
          {entry.evidence.lastPublishedAt&&<p className="text-xs cd-text-faint">최종 개방일: {date(entry.evidence.lastPublishedAt)} (대표자 변경일과 구분)</p>}
          {entry.match_level==="blocked"&&<p className="cd-error-text mt-1">번호 불일치로 반영할 수 없습니다. 마스터와 출처를 개별 확인하세요.</p>}
        </>:<>
          <div className="grid sm:grid-cols-2 gap-2">{FIELDS.filter(f=>!field||f===field).map(f=><div key={f} className="cd-text"><b>{LABELS[f]}</b> · {labels[entry.diagnosis?.[f]?.status]||"진단 대기"}<p className="cd-text-faint break-words">{entry.snapshot[f]||"(공란)"} {entry.diagnosis?.[f]?.status!=="valid"&&`— ${entry.diagnosis?.[f]?.reason||""}`}</p></div>)}</div>
          <details className="mt-2 cd-text-faint"><summary>보조 번호와 조회 결과</summary><p>사업장용 사업자번호: {entry.snapshot.site_business_registration_no||"(공란)"}</p><p>등록증 법인번호: {entry.snapshot.business_certificate_corporate_registration_no||"(공란)"}</p>{Object.entries(entry.outcomes||{}).map(([s,o])=><p key={s}>{sourceNames[s]||s}: {labels[o.status]||o.status} {o.note}</p>)}</details>
        </>}
      </article>)}{data&&!data.records.length&&<div className="cd-card p-8 text-center cd-text-faint">현재 조건에 해당하는 항목이 없습니다.</div>}</div>
      <div className="flex justify-end items-center gap-3 text-sm cd-text"><span>{data?.total||0}건 · {offset+1}–{Math.min(offset+50,data?.total||0)}</span><button className="cd-btn cd-btn-ghost" disabled={busy||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>이전</button><button className="cd-btn cd-btn-ghost" disabled={busy||offset+50>=(data?.total||0)} onClick={()=>setOffset(v=>v+50)}>다음</button></div>
    </>}
  </div>;
}
