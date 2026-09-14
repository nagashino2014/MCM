import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

// 로컬 PostgreSQL의 독립 스키마와 임시 파일만 사용한다. 외부 AI 호출은 대체한다.
const url = new URL(process.env.BUSINESS_CERT_TEST_DATABASE_URL || 'postgres://mcm_test@127.0.0.1:55432/mcm_quality_pilot');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
const schema = `bizcert_test_${Date.now()}`;
const out = path.resolve('.next', schema);
await mkdir(out, { recursive: true });
const client = new pg.Client({ connectionString: url.toString(), ssl: false });
await client.connect();
let checks = 0;
const check = (name) => { checks++; console.log(`PASS ${name}`); };
globalThis.__bizcert = { denied: false, llm: null, text: '', clova: '', configured: false, beforeAnalysis: null };
const state = globalThis.__bizcert;
try {
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  await client.query(`CREATE TABLE users(user_id text PRIMARY KEY, name text, email text);
    INSERT INTO users VALUES ('tester', '테스터', 'test@example.invalid');
    CREATE TABLE facilities(facility_id text PRIMARY KEY, company_name text, deleted_at text,
      business_certificate_business_type text, business_certificate_business_item text,
      business_certificate_corporate_registration_no text, business_certificate_ocr_text text,
      representative_name text, corporate_registration_no text, updated_at text);
    INSERT INTO facilities(facility_id,company_name,representative_name) VALUES ('site','시험회사','기존대표'),('other','다른회사','다른대표');`);
  await client.query(await readFile('../infra/aws/016_facility_business_certificates.sql', 'utf8'));
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.PGSSL = 'disable';
  process.env.FACILITY_DOCUMENT_STORAGE_ROOT = path.join(out, 'files');
  const mocks = {
    '@/lib/auth/guards': `import {NextResponse} from 'next/server';
      export async function requirePermission(){if(globalThis.__bizcert.denied)throw Object.assign(new Error('금지'),{status:403});return {userId:'tester'};}
      export function authErrorToResponse(e){return NextResponse.json({error:e.message},{status:e.status||500});}`,
    '@/lib/auth/audit': 'export async function recordAuditLogInline(){}',
    'business-certificate-llm': `export async function parseBusinessCertificateWithLlm(){
      const s=globalThis.__bizcert;if(s.beforeAnalysis){const f=s.beforeAnalysis;s.beforeAnalysis=null;await f();}
      if(s.llm instanceof Error)throw s.llm;return s.llm;}`,
    '@/lib/ocr/pdf-text': `export async function extractPdfTextLayer(){return globalThis.__bizcert.text;} export function hasUsableTextLayer(t){return t.length>30;}`,
    '@/lib/ocr/clova': `export function isClovaConfigured(){return globalThis.__bizcert.configured;}
      export async function clovaOcr(){const s=globalThis.__bizcert;if(s.clova instanceof Error)throw s.clova;return s.clova;}`,
  };
  await build({
    stdin: { contents: `export * as collection from './app/api/facilities/[id]/business-certificates/route';
      export * as item from './app/api/facilities/[id]/business-certificates/[certificateId]/route';
      export * as download from './app/api/facilities/business-certificates/download/route';
      export {analyzeBusinessCertificate} from './lib/ieps/business-certificate-analysis';`, resolveDir: process.cwd(), loader: 'ts' },
    outfile: path.join(out, 'routes.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external', tsconfig: 'tsconfig.json',
    plugins: [{ name: 'test-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        const key = args.path.endsWith('/business-certificate-llm') ? 'business-certificate-llm' : args.path;
        if (key in mocks) return { path: key, namespace: 'test' };
      });
      b.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: key }) => ({ contents: mocks[key], resolveDir: process.cwd(), loader: 'ts' }));
    } }],
  });
  const { collection, item, download, analyzeBusinessCertificate } = createRequire(import.meta.url)(path.join(out, 'routes.cjs'));
  const { NextRequest } = createRequire(import.meta.url)('next/server');
  const context = (certificateId, id = 'site') => ({ params: Promise.resolve({ id, certificateId }) });
  const req = (method) => new NextRequest('http://localhost/test', { method });
  const list = async () => (await (await collection.GET(req('GET'), context())).json()).items;
  const upload = async (preparsed = false) => {
    const form = new FormData();
    form.set('file', new File(['%PDF-test'], '등록증.pdf', { type: 'application/pdf' }));
    if (preparsed) { form.set('useParsedResult', '1'); form.set('ocrText', '확인된 원문'); form.set('businessType', '제조업'); }
    const response = await collection.POST(new NextRequest('http://localhost/test', { method: 'POST', body: form }), context());
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return response.json();
  };
  const fields = { companyName: '시험회사', businessRegistrationNo: '', representativeName: '새대표', siteAddress: '',
    businessType: '제조업', businessItem: '합성수지', businessKinds: [{ businessType: '제조업', businessItem: '합성수지' }],
    corporateRegistrationNo: '110111-0006422', ocrText: '등록증 원문', model: 'fixture' };
  state.llm = fields;
  const first = await upload();
  let facility = (await client.query("SELECT * FROM facilities WHERE facility_id='site'")).rows[0];
  assert.equal(facility.representative_name, '새대표');
  assert.equal(facility.business_certificate_business_item, '합성수지');
  check('갱신 업로드가 공통 분석 결과를 사업장에 반영');

  state.llm = null;
  const second = await upload();
  assert.ok(second.warning);
  facility = (await client.query("SELECT * FROM facilities WHERE facility_id='site'")).rows[0];
  assert.equal(facility.business_certificate_business_item, '합성수지');
  assert.ok((await list())[0].analysisWarning);
  check('분석 실패 파일 저장, 경고 노출, 기존 사업장 값 보존');

  state.llm = { ...fields, businessItem: '재분석종목' };
  let response = await item.POST(req('POST'), context(second.certificateId));
  assert.equal(response.status, 200);
  assert.equal((await list()).length, 2);
  assert.equal((await list())[0].analysisWarning, null);
  assert.equal((await client.query("SELECT business_certificate_business_item FROM facilities WHERE facility_id='site'")).rows[0].business_certificate_business_item, '재분석종목');
  check('현재본 재분석은 새 버전 없이 기존 항목과 사업장을 갱신');

  state.llm = { ...fields, businessItem: '과거종목' };
  response = await item.POST(req('POST'), context(first.certificateId));
  assert.equal((await response.json()).isCurrent, false);
  assert.equal((await client.query("SELECT business_certificate_business_item FROM facilities WHERE facility_id='site'")).rows[0].business_certificate_business_item, '재분석종목');
  check('과거본 재분석은 현재 사업장 정보를 덮어쓰지 않음');

  state.llm = null;
  response = await item.POST(req('POST'), context(second.certificateId));
  assert.ok((await response.json()).warning);
  assert.equal((await list())[0].businessItem, '재분석종목');
  check('재분석 실패 시 기존 등록증 분석 값도 보존');

  assert.equal((await item.DELETE(req('DELETE'), context(second.certificateId))).status, 409);
  assert.equal((await item.DELETE(req('DELETE'), context(first.certificateId, 'other'))).status, 404);
  state.denied = true;
  assert.equal((await item.POST(req('POST'), context(first.certificateId))).status, 403);
  assert.equal((await item.DELETE(req('DELETE'), context(first.certificateId))).status, 403);
  state.denied = false;
  check('현재본 삭제, 다른 사업장 ID 접근, 편집 권한 없는 요청 차단');

  const oldRow = (await client.query('SELECT * FROM facility_business_certificates WHERE certificate_id=$1', [first.certificateId])).rows[0];
  assert.equal((await item.DELETE(req('DELETE'), context(first.certificateId))).status, 200);
  assert.equal((await list()).length, 1);
  await assert.rejects(access(path.join(process.env.FACILITY_DOCUMENT_STORAGE_ROOT, oldRow.storage_key)));
  assert.equal((await download.GET(new NextRequest(`http://localhost${first.publicPath}`))).status, 404);
  assert.equal((await item.POST(req('POST'), context(first.certificateId))).status, 404);
  check('과거본 삭제 후 목록 제외, 원본 삭제, 다운로드·재분석 차단');

  const third = await upload(true);
  assert.equal(third.versionNo, 3);
  assert.equal(third.ocrText, '확인된 원문');
  check('삭제 후 버전 재사용 방지 및 사전 분석 원문 보존');

  state.llm = fields;
  state.beforeAnalysis = async () => {
    await client.query('UPDATE facility_business_certificates SET is_current=0 WHERE certificate_id=$1', [third.certificateId]);
    await client.query("UPDATE facilities SET business_certificate_business_item='최신업로드' WHERE facility_id='site'");
  };
  response = await item.POST(req('POST'), context(third.certificateId));
  assert.equal((await response.json()).isCurrent, false);
  assert.equal((await client.query("SELECT business_certificate_business_item FROM facilities WHERE facility_id='site'")).rows[0].business_certificate_business_item, '최신업로드');
  check('분석 도중 현재본 변경 시 최신 상태를 다시 확인');

  const concurrent = await Promise.all([upload(), upload()]);
  assert.equal(new Set(concurrent.map(v => v.versionNo)).size, 2);
  assert.equal((await list()).filter(v => v.isCurrent).length, 1);
  check('동시 업로드 시 버전 번호 분리 및 현재본 1개 유지');

  state.llm = new Error('분석 서비스 일시 실패');
  state.text = '사업자등록증\n법인명(단체명) : 시험회사\n대표자 : 홍길동\n사업장 소재지 : 서울특별시 강남구 테헤란로 1\n사업의 종류\n업태 제조업 종목 합성수지\n발급사유 재발급';
  const fallback = await analyzeBusinessCertificate(new File(['pdf'], 'test.pdf'));
  assert.equal(fallback.extractionMethod, 'text_layer');
  assert.equal(fallback.representativeName, '홍길동');
  state.text = '';
  state.configured = true;
  state.clova = new Error('OCR 일시 실패');
  assert.ok((await analyzeBusinessCertificate(new File(['pdf'], 'test.pdf'))).warning);
  check('주 분석 서비스 실패 시 텍스트 추출 대체 경로 및 OCR 실패 경고');

  console.log(`${checks} integration checks passed`);
} finally {
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.end();
  assert.ok(out.startsWith(path.resolve('.next') + path.sep));
  await rm(out, { recursive: true, force: true });
}
