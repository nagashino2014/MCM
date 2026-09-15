"use client";
import { useEffect, useState } from "react";
/** 역할 문자열 대신 서버 권한 템플릿과 동일한 판정으로 편집 진입점을 표시한다. */
export function useFacilityEditPermission() {
  const [canEdit,setCanEdit]=useState(false);
  useEffect(()=>{const controller=new AbortController();fetch('/api/facilities/enrich?capabilities=1',{cache:'no-store',signal:controller.signal}).then(async r=>{if(r.ok)setCanEdit((await r.json()).canEdit===true);}).catch(()=>{});return()=>controller.abort();},[]);
  return canEdit;
}
