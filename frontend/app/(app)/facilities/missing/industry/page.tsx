"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FacilityDetailPanel } from "@/components/facilities/FacilityDetailPanel";
import { ToastProvider } from "@/components/ui/Toast";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { useFacilityEditPermission } from "@/components/facilities/useFacilityEditPermission";
import type { FacilityListItem } from "@/lib/ieps/types-facility";
import "@/components/cdash/cdash.css";
export default function IndustryMissingPage() { return <ToastProvider><Inner/></ToastProvider>; }
function Inner() {
  const canEdit=useFacilityEditPermission();
  const {theme}=useCdashTheme();
  const [items,setItems]=useState<FacilityListItem[]>([]);
  const [offset,setOffset]=useState(0);
  const [total,setTotal]=useState(0);
  const [selected,setSelected]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const reload=useCallback(async()=>{setLoading(true);try{const r=await fetch(`/api/facilities?missing=industry&sort=name&limit=10&offset=${offset}`);const d=await r.json();if(!r.ok)throw new Error(d.error||"조회 실패");setItems(d.items);setTotal(d.total);setSelected(v=>v||d.items[0]?.facilityId||null);setError("");}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[offset]);
  useEffect(()=>{void reload();},[reload]);
  return <div className="cdash p-5" data-theme={theme}>
    <Link href="/facilities/missing" className="cd-btn cd-btn-ghost mb-4">사업장 정보 전수 점검</Link>
    <h1 className="text-xl font-bold cd-text mb-4">업종코드·업종명 누락 점검</h1>
    {error&&<p role="alert" className="cd-error-text">{error}</p>}
    <div className="grid lg:grid-cols-[340px_1fr] gap-4"><div className="cd-card p-3 rounded-2xl flex flex-col gap-2">{items.map(f=><button key={f.facilityId} onClick={()=>setSelected(f.facilityId)} className="cd-btn cd-btn-ghost text-left">{f.companyName}</button>)}<PaginationControls total={total} offset={offset} limit={10} loading={loading} onPageChange={setOffset}/></div><FacilityDetailPanel facilityId={selected} canEdit={canEdit} onUpdated={reload} onDeleted={reload}/></div>
  </div>;
}
