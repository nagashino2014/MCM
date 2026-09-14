import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwind from 'tailwindcss';

const root = process.cwd();
const out = path.resolve('.next/business-certificates-ui');
mkdirSync(out, { recursive: true });
const source = readFileSync('components/facilities/FacilityDetailPanel.tsx', 'utf8');
const component = source.slice(source.indexOf('function BusinessCertificatesSection('), source.indexOf('\nfunction EditView('));
const fixture = `
window.__actions=[];
const certificates=[{certificateId:'current',versionNo:2,isCurrent:true,displayName:'검증회사 사업자등록증 v2.pdf',createdAt:'2026-09-14',analysisWarning:'분석 결과가 없습니다. 재분석해 주세요.',publicPath:'#pdf'},
{certificateId:'old',versionNo:1,isCurrent:false,displayName:'검증회사 사업자등록증 v1.pdf',createdAt:'2026-09-13',publicPath:'#pdf'}];
window.fetch=async(url,options)=>{window.__actions.push({url,method:options.method});await new Promise(r=>setTimeout(r,80));
if(options.method==='DELETE')certificates.splice(1,1);else{certificates[0].analysisWarning=null;certificates[0].businessType='제조업';}
return Response.json({isCurrent:true});};
function App(){const [detail,setDetail]=useState({facilityId:'site',businessCertificates:[...certificates]});
return <main className="cdash cdash-vars" style={{padding:16,minHeight:'100vh',background:'var(--cd-bg)'}}><BusinessCertificatesSection detail={detail} canEdit={true} onChanged={()=>setDetail({...detail,businessCertificates:certificates.map(c=>({...c}))})}/></main>}
createRoot(document.getElementById('root')).render(<App/>);`;
await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{FileText,Upload}from'lucide-react';import './components/cdash/cdash.css';${component}\n${fixture}`, resolveDir: root, loader: 'tsx' },
  outfile: path.join(out, 'preview.js'), bundle: true, platform: 'browser', jsx: 'automatic', tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' } });
const css = await postcss([tailwind({ content: ['components/facilities/FacilityDetailPanel.tsx'] })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined });
writeFileSync(path.join(out, 'tailwind.css'), css.css);
const server = createServer((req, res) => {
  const file = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html','preview.js','preview.css','tailwind.css'].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  res.end(file==='index.html'?'<html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="/tailwind.css"><link rel="stylesheet" href="/preview.css"><div id="root"></div><script src="/preview.js"></script></html>':readFileSync(path.join(out,file)));
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const { chromium } = createRequire(path.resolve('../scraper/package.json'))('playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'재분석',exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'재분석',exact:true}).count(),2);
  assert.equal(await page.getByRole('button',{name:'삭제',exact:true}).count(),1);
  await page.screenshot({path:path.join(out,'desktop.png')});
  await page.getByRole('button',{name:'재분석',exact:true}).first().click();
  await page.getByRole('status').filter({hasText:'재분석 결과를 사업장 정보에 반영했습니다.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'재분석',exact:true}).count(),2);
  assert.equal(await page.getByText('분석 결과가 없습니다. 재분석해 주세요.',{exact:true}).count(),0);
  await page.getByRole('button',{name:'삭제',exact:true}).click();
  await page.getByRole('status').filter({hasText:'과거 업로드본을 삭제했습니다.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'재분석',exact:true}).count(),1);
  assert.deepEqual(await page.evaluate(()=>window.__actions.map(a=>a.method)),['POST','DELETE']);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(out,'mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('UI passed: reanalysis, history deletion, current copy protection, messages, desktop/mobile, no runtime errors');
} finally { await browser.close(); server.close(); }
