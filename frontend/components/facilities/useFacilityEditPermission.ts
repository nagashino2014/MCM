"use client";
import { useEffect, useState } from "react";
export interface FacilityCapabilities { canEdit: boolean; canDelete: boolean; canMerge: boolean }
/** 역할 문자열 대신 서버 권한 템플릿과 동일한 판정으로 편집·삭제·병합 진입점을 표시한다(facility.edit·delete·merge). */
export function useFacilityCapabilities(): FacilityCapabilities {
  const [caps,setCaps]=useState<FacilityCapabilities>({canEdit:false,canDelete:false,canMerge:false});
  useEffect(()=>{const controller=new AbortController();fetch('/api/facilities/enrich?capabilities=1',{cache:'no-store',signal:controller.signal}).then(async r=>{if(r.ok){const j=await r.json();setCaps({canEdit:j.canEdit===true,canDelete:j.canDelete===true,canMerge:j.canMerge===true});}}).catch(()=>{});return()=>controller.abort();},[]);
  return caps;
}
export function useFacilityEditPermission() {
  return useFacilityCapabilities().canEdit;
}
