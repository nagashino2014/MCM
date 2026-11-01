import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedOfficialUrl, defaultOfficialConfig, emptyOfficialState, officialHtmlToText, officialProvider, officialSourceState, validateOfficialUpdate } from "../lib/intel/official-sources-policy";
import { isPublicOfficialAddress } from "../lib/intel/official-sources-fetch";
import { collectOfficialDocuments, officialArticleLinks, officialDate, parseKosisResponse, parseLawResponse, parseOfficialHtml } from "../lib/intel/official-sources-connectors";
import { canManageOfficialSources } from "../lib/intel/official-sources-access";
import type { UserAccess } from "../lib/auth/rbac";
import { assertLegacyBriefingSourcePolicy } from "../lib/intel/official-sources-visibility";

const series = { label: "반도체 생산", orgId: "101", tblId: "TEST_TABLE", itmId: "T1", objL1: "C26", prdSe: "M" as const };
const sample = { ORG_ID: "101", TBL_ID: "TEST_TABLE", ITM_ID: "T1", ITM_NM: "생산지수", C1: "C26", C1_NM: "반도체", PRD_SE: "M", PRD_DE: "202609", DT: "-", UNIT_NM: "2020=100", LST_CHN_DE: "20261030" };
test("공식 호스트 allowlist는 내부 URL·사용자정보·임의 호스트를 거부한다", () => {
  const provider = officialProvider("kdi");
  for (const url of ["http://www.kdi.re.kr/", "https://127.0.0.1/", "https://www.kdi.re.kr.evil.test/", "https://user:pass@www.kdi.re.kr/", "https://www.kdi.re.kr:8443/"]) assert.throws(() => allowedOfficialUrl(provider, url));
  assert.equal(allowedOfficialUrl(provider, "https://www.kdi.re.kr/research/monTrends#fragment").hash, "");
});
test("DNS 보호는 loopback·private·metadata·예약주소·mapped IPv6를 거부한다", () => {
  for (const ip of ["127.0.0.1", "169.254.169.254", "10.0.0.1", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "192.0.2.1", "198.18.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1"]) assert.equal(isPublicOfficialAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicOfficialAddress(ip), true, ip);
});
test("미검증·미인증·권리대기·참고링크를 운영 성공으로 표시하지 않는다", () => {
  const kosis = officialProvider("kosis"), state = emptyOfficialState();
  assert.equal(officialSourceState(kosis, state, defaultOfficialConfig(kosis), false), "rights_pending");
  state.permissions.collectionAllowed = state.permissions.storageAllowed = true;
  assert.equal(officialSourceState(kosis, state, { series: [series] }, false), "credentials_pending");
  assert.equal(officialSourceState(kosis, state, { series: [] }, true), "configuration_pending");
  assert.equal(officialSourceState(kosis, state, { series: [series] }, true), "verification_pending");
  assert.equal(officialSourceState(officialProvider("kiet"), state, {}, false), "reference_only");
});
test("시계열은 표2개·시계열6개·단일 분류 범위이고 참고정보원은 활성화할 수 없다", () => {
  const base = { providerId: "kosis", enabled: false, expectedVersion: 0, permissions: emptyOfficialState().permissions, config: { series: [series] } };
  assert.equal(validateOfficialUpdate(base).config.series?.length, 1);
  assert.throws(() => validateOfficialUpdate({ ...base, config: { series: [{ ...series, objL1: "ALL" }, { ...series, objL1: "*" }] } }));
  assert.throws(() => validateOfficialUpdate({ ...base, config: { series: [series, series] } }));
  assert.throws(() => validateOfficialUpdate({ ...base, providerId: "kiet", enabled: true, config: {} }));
  assert.throws(() => validateOfficialUpdate({ ...base, permissions: { ...base.permissions, storageAllowed: true } }));
});
test("KOSIS 결측부호는 null로 유지하고 수치·수정일·공표일을 혼동하지 않는다", () => {
  const [missing] = parseKosisResponse([sample], series);
  assert.equal(missing.structuredData.value, null); assert.equal(missing.structuredData.rawValue, "-"); assert.equal(missing.publishedAt, null);
  assert.equal(parseKosisResponse([{ ...sample, DT: "1,234.5" }], series)[0].structuredData.value, 1234.5);
  assert.throws(() => parseKosisResponse([{ ...sample, C1: "OTHER" }], series));
  assert.throws(() => parseKosisResponse({ err: "invalid key" }, series));
});
test("법령 시행일과 공포일을 분리하고 적용여부를 확정하지 않는다", () => {
  const law = parseLawResponse({ 법령: { 기본정보: { 법령명_한글: "환경오염시설의 통합관리에 관한 법률", 공포일자: "20261001", 시행일자: "20270101" }, 조문: { 조문내용: "환경오염시설 관리 기준을 정한다." } } }, { target: "law", id: "1234" });
  assert.equal(law.publishedAt, "2026-10-01T00:00:00.000Z"); assert.equal(law.structuredData.effectiveAt, "2027-01-01T00:00:00.000Z");
  assert.equal(law.structuredData.applicationStatus, "담당자 검토 필요"); assert.ok(!law.url.includes("OC="));
  assert.equal(officialDate("20260230"), null);
});
test("HTML은 실행가능 요소 없이 평문으로 저장하고 로그인·차단·미확인 이용조건은 거부한다", () => {
  assert.equal(officialHtmlToText('<script>steal()</script><nav>메뉴</nav><p>공개 <b>자료</b></p><iframe src="x"></iframe>'), "공개 자료");
  const kdi = officialProvider("kdi"), text = "산업 생산과 수출 동향에 대한 공식 월간 분석 자료입니다. ".repeat(8);
  const base = `<html><title>KDI 경제동향 2026.10</title><main><div class="m_v-post"><div class="post-top"><div class="tit">KDI 경제동향 2026.10</div></div><div class="post-box"><div class="editor-template">${text}</div></div></div>`;
  assert.throws(() => parseOfficialHtml(kdi, `${base}</main></html>`, kdi.homeUrl));
  const doc = parseOfficialHtml(kdi, `${base}<div class="nuri_top"><img alt="공공누리 제1유형"></div></main></html>`, kdi.homeUrl);
  assert.equal(doc.externalId, "kdi:2026-10"); assert.equal(doc.publishedAt, null);
  assert.throws(() => parseOfficialHtml(kdi, "<body>cf-chl-platform</body>", kdi.homeUrl));
});
test("KDI 개별 본문과 라이선스만 읽고 메뉴·차트·직원 확인 문구는 제외한다", () => {
  const kdi = officialProvider("kdi"), text = "반도체 관련 투자가 지속되어 산업 생산과 수출이 증가했습니다. ".repeat(4);
  const html = `<html><title>다른 메뉴</title><main><div>이전 자료 2025.01.01 메뉴</div><div class="m_v-post"><div class="post-top"><div class="tit"><span>KDI 경제동향 2026.10</span></div><div class="tit-info"><div class="date">2026.10.12</div><button>원문 다운로드</button></div></div><div class="post-box"><div class="editor-template"><div>${text}</div><script>악성 스크립트</script></div><div class="editor-template">설비투자 동향 목차</div><div class="post-graph">그래프 영역입니다</div></div></div><div class="nuri_top">한국개발연구원의 본 저작물은 공공누리 제1유형 : 출처표시 조건으로 이용할 수 있습니다.</div><div>직원 정보 010-1234-5678 보안문자 확인</div></main></html>`;
  const doc = parseOfficialHtml(kdi, html, `${kdi.homeUrl}?pub_no=19304`);
  assert.equal(doc.title, "KDI 경제동향 2026.10"); assert.equal(doc.publishedAt, "2026-10-12T00:00:00.000Z");
  assert.ok(doc.normalizedText.includes(text.trim())); assert.ok(doc.normalizedText.includes("설비투자 동향 목차"));
  assert.doesNotMatch(doc.normalizedText, /2025|다운로드|그래프|직원|010-|보안문자|스크립트/);
  assert.equal(doc.structuredData.licenseEvidenceUrl, doc.url);
  assert.throws(() => parseOfficialHtml(kdi, html.replace('class="nuri_top"', 'class="unrelated"'), kdi.homeUrl));
  assert.throws(() => parseOfficialHtml(kdi, html.replace("공공누리 제1유형", "공공누리 제3유형"), kdi.homeUrl));
  assert.throws(() => parseOfficialHtml(kdi, html.replace('class="m_v-post"', 'class="changed-layout"'), kdi.homeUrl));
});
test("목록 링크의 외부 주소와 임의 파일은 수집하지 않는다", () => {
  const kdi = officialProvider("kdi");
  assert.deepEqual(officialArticleLinks(kdi, '<a href="/research/monTrends?pub_no=123">이전</a><a href="https://evil.test/research/monTrends?pub_no=4">외부</a><a href="/download.pdf">PDF</a>', kdi.homeUrl), ["https://www.kdi.re.kr/research/monTrends?pub_no=123"]);
});
test("실제 KDI 월 선택 버튼은 코드 실행 없이 최신 순으로 읽는다", () => {
  const kdi = officialProvider("kdi"), html = `<button onclick="location.href='/research/monTrends?pub_no=19252'">8월</button><button onclick="location.href='/research/monTrends?pub_no=19271'">9월</button><button onclick="location.href='/research/monTrends?pub_no=19304'">10월</button><button onclick="location.href='https://evil.test/'">외부</button>`;
  assert.deepEqual(officialArticleLinks(kdi, html, kdi.homeUrl), [19304, 19271, 19252].map(id => `${kdi.homeUrl}?pub_no=${id}`));
});
test("전사 정보원 관리는 scope all 편집 허용과 deny 우선을 모두 요구한다", () => {
  const access = { userId: "u", role: "member", deptId: "d", employeeId: "e", postDeptIds: ["d"], headDeptIds: new Set(), participantContractIds: new Set(), participantProjectIds: new Set(), deptIds: new Set(), deptContractIds: new Set(), deptProjectIds: new Set(), deptContractsByDept: new Map(), deptProjectsByDept: new Map(), grants: [] } as UserAccess;
  for (const scopeKind of ["self", "participant", "self_dept", "specific_dept"] as const) { access.grants = [{ permissionKey: "sales.edit", scopeKind, scopeDeptId: "d", effect: "allow" }]; assert.equal(canManageOfficialSources(access), false); }
  access.grants = [{ permissionKey: "sales.edit", scopeKind: "all", scopeDeptId: null, effect: "allow" }]; assert.equal(canManageOfficialSources(access), true);
  access.grants.push({ permissionKey: "sales.edit", scopeKind: "self_dept", scopeDeptId: "d", effect: "deny" }); assert.equal(canManageOfficialSources(access), false);
});
test("connector fixture는 API 인증키를 결과 URL·본문·구조정보에 저장하지 않는다", async () => {
  const docs = await collectOfficialDocuments(officialProvider("kosis"), { series: [series] }, "fixture-secret", async (_p, url) => ({ text: JSON.stringify([sample]), url, contentType: "application/json" }));
  assert.equal(docs.length, 1); assert.equal(JSON.stringify(docs).includes("fixture-secret"), false);
});
test("행정규칙은 개정 일련번호 ID 대신 안정된 LID로 조회한다", async () => {
  let requested = "";
  await collectOfficialDocuments(officialProvider("law"), { laws: [{ id: "123", target: "admrul" }] }, "fixture", async (_provider, url) => { requested = url; return { url, contentType: "application/json", text: JSON.stringify({ 행정규칙: { 행정규칙명: "환경 관리 행정규칙", 조문내용: "공개 환경 관리 행정규칙의 업무 처리 기준을 정한다." } }) }; });
  const url = new URL(requested); assert.equal(url.searchParams.get("LID"), "123"); assert.equal(url.searchParams.has("ID"), false);
});
test("구형 보고서의 공식자료 혼입은 재분석·공유 전에 차단하고 신규 revision 보고서는 별도 ACL로 처리한다", () => {
  assert.throws(() => assertLegacyBriefingSourcePolicy({ sources: [{ source: "official:skhynix" }] }), e => (e as { status: number }).status === 403);
  assert.throws(() => assertLegacyBriefingSourcePolicy({ sources: JSON.stringify([{ kind: "official", source: "KDI 경제동향" }]) }));
  assert.doesNotThrow(() => assertLegacyBriefingSourcePolicy({ sources: [{ source: "news" }] }));
  assert.doesNotThrow(() => assertLegacyBriefingSourcePolicy({ access_scope: "restricted", sources: [{ kind: "official" }] }));
});
