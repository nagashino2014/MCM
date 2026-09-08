// 합성 데이터로 화면의 선택·반영·복원·라이트/다크를 검증한다. 운영 API는 호출하지 않는다.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
import assert from "node:assert/strict";
const root=process.cwd();const out=path.join(root,".next-quality-preview");mkdirSync(out,{recursive:true});
const mock=`
const snap={facility_id:'preview',company_name:'검증회사(주)',business_registration_no:'2078100390',phone_number:null,representative_name:null,corporate_registration_no:null,site_address:'경기도 파주시 산업단지길 76',site_business_registration_no:null,business_certificate_corporate_registration_no:null};
const run={run_id:'preview-run',mode:'audit',status:'completed',created_at:'2026-09-08T07:00:00Z'};
const candidate={candidate_id:'preview-candidate',facility_id:'preview',field:'business_registration_no',value:'207-81-00390',old_value:'2078100390',source:'format',status:'pending',recommended:true,match_level:'format',snapshot:snap,evidence:{reason:'숫자 변화 없는 표기 정리'}};
const fields=['business_registration_no','phone_number','representative_name','corporate_registration_no','site_address'];
window.__qualityActions=[];
window.fetch=async(url,options)=>{const u=new URL(url,location.origin);if(options?.method==='POST'&&u.pathname.endsWith('/apply')){const body=JSON.parse(options.body);window.__qualityActions.push(body);candidate.status=body.action==='revert'?'reverted':body.action==='reject'?'rejected':'applied';return Response.json({results:[{id:candidate.candidate_id,status:candidate.status}]});}
if(!u.searchParams.get('runId'))return Response.json({runs:[run],queueEnabled:true});
const records=u.searchParams.get('view')==='items'?[{facility_id:'preview',snapshot:snap,status:'completed',diagnosis:Object.fromEntries(fields.map(f=>[f,{status:f==='business_registration_no'?'format':f==='site_address'?'valid':'missing',value:snap[f],reason:'원본 확인'}])),outcomes:{}}]:(!u.searchParams.get('status')||u.searchParams.get('status')===candidate.status?[candidate]:[]);
return Response.json({run,counts:[{status:'completed',count:1}],fields:fields.map(f=>({field:f,status:f==='business_registration_no'?'format':f==='site_address'?'valid':'missing',count:1})),records,total:records.length});};`;
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{FacilityQualityPanel}from'./components/facilities/FacilityQualityPanel';${mock};createRoot(document.getElementById('root')).render(<FacilityQualityPanel/>);`,resolveDir:root,loader:"tsx"},outfile:path.join(out,"preview.js"),bundle:true,platform:"browser",jsx:"automatic",tsconfig:"tsconfig.json",define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"link-fixture",setup(b){b.onResolve({filter:/^next\/link$/},()=>({path:"next-link",namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"import React from 'react';export default function Link(p){return React.createElement('a',p,p.children)}",resolveDir:root}));}}]});
const css=await postcss([tailwind({content:["components/facilities/FacilityQualityPanel.tsx","components/cdash/CdPageHeader.tsx"]})]).process("@tailwind base;@tailwind components;@tailwind utilities;",{from:undefined});writeFileSync(path.join(out,"tailwind.css"),css.css);
const server=createServer((req,res)=>{const file=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','preview.js','preview.css','tailwind.css'].includes(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(file==='index.html'?`<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="/tailwind.css"><link rel="stylesheet" href="/preview.css"><div id="root"></div><script src="/preview.js"></script></html>`:readFileSync(path.join(out,file)));});
await new Promise(r=>server.listen(3008,'127.0.0.1',r));
const require=createRequire(path.resolve('../scraper/package.json'));const{chromium}=require('playwright');const browser=await chromium.launch({headless:true});
const screenshots=path.resolve('../../quality-artifacts');mkdirSync(screenshots,{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('cdash-theme','light'));await page.goto('http://127.0.0.1:3008');await page.getByText('검증회사(주)',{exact:true}).waitFor();
  await page.screenshot({path:path.join(screenshots,'quality-ui-light.png'),fullPage:true});
  await page.getByRole('button',{name:'후보 검토·변경 이력',exact:true}).click();await page.getByText('제안: 207-81-00390').waitFor();
  await page.screenshot({path:path.join(screenshots,'quality-ui-candidates.png'),fullPage:true});
  await page.getByRole('button',{name:'이 페이지 형식 수정 선택',exact:true}).click();await page.getByRole('button',{name:'선택 반영 (1)',exact:true}).click();await page.getByRole('status').filter({hasText:'반영됨 1건'}).waitFor();
  await page.getByLabel('상태 필터').selectOption('applied');await page.getByLabel('검증회사(주) 사업자번호 선택').check();await page.getByRole('button',{name:'선택 복원',exact:true}).click();await page.getByRole('status').filter({hasText:'복원됨 1건'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__qualityActions.map(a=>a.action)),['apply','revert']);
  await page.evaluate(()=>{localStorage.setItem('cdash-theme','dark');window.dispatchEvent(new Event('cdash-theme-change'));});await page.getByRole('button',{name:'원본 진단',exact:true}).click();await page.getByText('경기도 파주시 산업단지길 76',{exact:true}).waitFor();
  await page.screenshot({path:path.join(screenshots,'quality-ui-dark.png'),fullPage:true,animations:'disabled'});
  await page.getByLabel('항목 필터').selectOption('phone_number');await page.waitForFunction(()=>document.querySelectorAll('article b').length===1&&document.querySelector('article b')?.textContent==='전화번호');
  await page.getByLabel('항목 필터').selectOption('');await page.getByText('경기도 파주시 산업단지길 76',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.locator('article').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(screenshots,'quality-ui-mobile.png'),animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'모바일 가로 넘침');assert.deepEqual(errors,[]);console.log('UI passed: field filters, selection, apply, revert, light/dark, mobile overflow, no runtime errors');
}finally{await browser.close();server.close();}
