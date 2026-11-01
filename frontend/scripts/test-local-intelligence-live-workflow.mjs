// 실제 공개 수집 자료를 이용한 로컬 업무흐름 검증. AI·수집·원본 DB 호출은 하지 않는다.
// 새 영업건과 활동은 intel_live에 [로컬검증] 이름으로 보존한다. 자동 삭제하지 않는다.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = "http://127.0.0.1:4174";
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const output = resolve(".next/local-intelligence-demo/workflows", stamp);
await mkdir(output, { recursive: true });
const record = { startedAt: new Date().toISOString(), base, database: "intel_live", status: "running", checks: [], screenshots: [], mutations: [] };
const allowedMutation = (path, method) => (method === "POST" && /^\/api\/sales\/intel\/projects\/[^/]+\/links$/.test(path))
  || (method === "POST" && path === "/api/sales/intel/actions")
  || (method === "PATCH" && /^\/api\/sales\/intel\/actions\/[^/]+$/.test(path));
async function api(path, options = {}, expectedStatus) {
  const method = options.method ?? "GET";
  assert(method === "GET" || allowedMutation(path, method), `이 검증에 허용되지 않은 변경 요청: ${method} ${path}`);
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(base + path, { ...options, headers: { "content-type": "application/json", origin: base, ...options.headers } });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      // 이미 보낸 요청도 동일 requestKey로만 재전송한다.
      await new Promise(done => setTimeout(done, 300 * (attempt + 1)));
    }
  }
  const body = await response.json();
  if (expectedStatus) assert.equal(response.status, expectedStatus, JSON.stringify(body));
  else assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
const check = (name, detail = {}) => { record.checks.push({ name, ...detail }); console.log(`PASS: ${name}`); };
let browser;
let page;
try {
  const health = await api("/api/local-demo/health");
  assert.equal(health.localIntelligenceDemo, true);
  assert.equal(health.mode, "real");
  assert.equal(health.database, "intel_live", "분리된 실제자료 로컬 DB에서만 실행합니다.");
  const baseline = await api("/api/local-demo/meta");
  assert(baseline.import?.importedSignals > 0 && baseline.import.importedAt);
  record.import = baseline.import;
  record.aiBefore = baseline.lastAiCall;
  const run = (await api("/api/sales/rag/runs")).runs.find(item => item.status === "published");
  assert(run, "기존 발행 보고서가 필요합니다. 이 검증에서는 보고서를 생성하지 않습니다.");
  const published = await api(`/api/sales/rag/runs/${run.runId}`);
  assert(published.briefing?.sources?.length);
  // 실제 투자에 관한 근거와 검토 가능한 서비스 제안이 있는 프로젝트를 선택한다.
  const candidates = published.briefing.sources
    .map((source, index) => ({ ...source, citation: index + 1 }))
    .filter(source => source.kind === "project" && /청주 공장|공장 신설|신규시설투자|증설|투자/.test(source.reportName ?? ""));
  let target;
  for (const source of candidates) {
    const detail = await api(`/api/sales/intel/projects/${source.signalId.slice(8)}`);
    if (detail.project?.facilityId && detail.signals?.length && detail.recommendedActions?.length && detail.canEdit) {
      target = { source, detail };
      break;
    }
  }
  assert(target, "보고서 근거 중 사업장·검토 제안이 있는 실제 투자 프로젝트가 없습니다.");
  const { source, detail: initial } = target;
  const projectId = initial.project.projectId;
  const projectPath = `/api/sales/intel/projects/${projectId}`;
  const employees = (await api("/api/sales/employees")).employees;
  const owner = employees.find(employee => employee.employeeId === "e1");
  assert(owner?.deptId && owner.name.includes("시험계정"));
  record.runId = run.runId;
  record.briefingId = published.briefing.briefingId;
  record.source = { citation: source.citation, projectId, title: initial.project.title, signalIds: initial.signals.map(signal => signal.signal_id), facilityId: initial.project.facilityId, region: initial.project.region };
  check("실제 수집 자료와 기존 발행 보고서 확인", { runId: run.runId, citation: source.citation });

  const { chromium } = await import(pathToFileURL(process.env.MCM_PLAYWRIGHT_PATH || resolve("../scraper/node_modules/playwright/index.mjs")).href);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const blocked = [];
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin !== base || (!["GET", "HEAD"].includes(method) && !allowedMutation(url.pathname, method))) {
      blocked.push(`${method} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  async function screenshot(name) {
    const path = resolve(output, `${name}.png`);
    await page.screenshot({ path, fullPage: true });
    record.screenshots.push(path);
  }
  async function save(dialog, path, method) {
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method);
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    const response = await pending;
    const payload = response.request().postDataJSON();
    const result = await response.json();
    assert(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(result)}`);
    assert(payload.requestKey, "UI 저장에 재시도 키가 있어야 합니다.");
    await dialog.waitFor({ state: "hidden" });
    const mutation = { path, method, payload, result };
    record.mutations.push(mutation);
    return mutation;
  }
  async function replay(mutation) {
    return api(mutation.path, { method: mutation.method, body: JSON.stringify(mutation.payload) });
  }
  await page.goto(`${base}/sales/rag?tab=scheduled&runId=${run.runId}`);
  await page.getByRole("button", { name: "PDF 다운로드", exact: true }).waitFor();
  const allSources = page.getByRole("button", { name: /^전체 \d+건 보기$/ });
  if (await allSources.count()) await allSources.click();
  const compactSource = page.getByRole("button", { name: `[${source.citation}] ${source.reportName}`, exact: true });
  const sourceCard = await compactSource.count() ? compactSource : page.locator("button.rag-src-card").nth(source.citation - 1);
  assert.equal(await sourceCard.count(), 1, "선택한 발행 근거를 화면에서 식별할 수 있어야 합니다.");
  await sourceCard.scrollIntoViewIfNeeded();
  await screenshot("01-published-evidence");
  await sourceCard.click();
  await page.waitForURL(url => url.searchParams.get("tab") === "projects" && url.searchParams.get("projectId") === projectId);
  await page.getByRole("button", { name: "영업·계약 연결", exact: true }).waitFor();
  await page.getByRole("heading", { name: "근거 자료", exact: true }).waitFor();
  await screenshot("02-evidence-project");
  check("발행 보고서 근거 클릭 → 실제 투자 프로젝트 상세 이동");

  const salesTitle = `[로컬검증] 실제 브리핑 영업 연결 ${stamp}`;
  const scopeKey = `[로컬검증] 공개 근거 후속 검토 ${stamp}`;
  record.salesTitle = salesTitle;
  await page.getByRole("button", { name: "영업·계약 연결", exact: true }).click();
  const linkDialog = page.getByRole("dialog", { name: "영업·계약 연결", exact: true });
  await linkDialog.getByLabel("연결 방법", { exact: true }).selectOption("create");
  await linkDialog.getByLabel("영업건명").fill(salesTitle);
  await linkDialog.getByLabel("용역 범위").fill(scopeKey);
  await linkDialog.getByLabel("서비스", { exact: true }).selectOption("integrated_permit");
  await linkDialog.getByLabel("영업 담당자").selectOption(owner.employeeId);
  await screenshot("03-new-local-sales");
  const linked = await save(linkDialog, `${projectPath}/links`, "POST");
  const salesProjectId = linked.result.salesProjectId;
  assert(salesProjectId);
  record.salesProjectId = salesProjectId;
  const savedSales = await api(`/api/local-demo/sales/${salesProjectId}`);
  assert.equal(savedSales.project.title, salesTitle);
  assert.equal(savedSales.project.facilityId, initial.project.facilityId);
  assert.equal(savedSales.project.expectedAmount, null, "투자액을 용역 매출액으로 복사하지 않아야 합니다.");
  assert.equal(savedSales.activities.length, 0, "연결만으로 영업활동이 자동 실행되지 않아야 합니다.");
  assert.deepEqual(await replay(linked), linked.result);
  const sameScope = await api(linked.path, { method: "POST", body: JSON.stringify({ ...linked.payload, requestKey: randomUUID() }) });
  assert.equal(sameScope.salesProjectId, salesProjectId, "동일 서비스·업무 범위도 새 영업건을 만들지 않아야 합니다.");
  check("UI 신규 영업건 저장 · 같은 요청 및 같은 업무 범위 중복 방지", { salesProjectId });

  await page.reload();
  await page.getByRole("button", { name: "영업·계약 연결", exact: true }).waitFor();
  const recommendation = initial.recommendedActions[0];
  const recommendedRow = page.locator("li").filter({ has: page.getByText(recommendation.title, { exact: true }) });
  await recommendedRow.getByRole("button", { name: "검토 등록", exact: true }).click();
  const actionDialog = page.getByRole("dialog", { name: "후속 활동 검토", exact: true });
  const proposedTitle = await actionDialog.getByLabel("활동 제목").inputValue();
  assert.equal(proposedTitle, recommendation.title);
  const actionTitle = `[로컬검증] ${recommendation.title} ${stamp}`;
  record.actionTitle = actionTitle;
  await actionDialog.getByLabel("활동 제목").fill(actionTitle);
  await actionDialog.getByLabel("활동 유형", { exact: true }).selectOption("email");
  await actionDialog.getByLabel("영업건 검색", { exact: true }).fill(salesTitle);
  await actionDialog.getByRole("button", { name: "검색", exact: true }).click();
  await actionDialog.getByLabel("영업건", { exact: true }).selectOption(salesProjectId);
  await actionDialog.getByLabel("담당자", { exact: true }).selectOption(owner.employeeId);
  const futureDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await actionDialog.getByLabel("예정일", { exact: true }).fill(futureDate.replaceAll("-", ""));
  await actionDialog.getByLabel("예정 시각 (KST)", { exact: true }).fill("10:30");
  await screenshot("04-recommended-action-review");
  const proposed = await save(actionDialog, "/api/sales/intel/actions", "POST");
  const actionId = proposed.result.action.actionId;
  record.actionId = actionId;
  assert.equal(proposed.result.action.status, "proposed");
  assert.deepEqual(proposed.payload.evidenceSignalIds, recommendation.evidenceSignalIds);
  assert.deepEqual(await replay(proposed), proposed.result);
  assert.equal((await api(`/api/local-demo/sales/${salesProjectId}`)).activities.length, 0);
  check("근거 기반 권장 활동을 제안으로 저장 · 검토 전 실제 활동 미생성 · 제안 중복 방지", { actionId });

  const actionRow = page.getByRole("row").filter({ hasText: actionTitle });
  await actionRow.getByRole("button", { name: "검토", exact: true }).click();
  await actionDialog.getByLabel("처리", { exact: true }).selectOption("accept");
  const accepted = await save(actionDialog, `/api/sales/intel/actions/${actionId}`, "PATCH");
  assert(accepted.result.activityId);
  record.activityId = accepted.result.activityId;
  assert.deepEqual(await replay(accepted), accepted.result);
  await api(accepted.path, { method: "PATCH", body: JSON.stringify({ ...accepted.payload, requestKey: randomUUID() }) }, 409);
  await api(proposed.path, { method: "POST", body: JSON.stringify({ ...proposed.payload, title: `${actionTitle} 변경` }) }, 409);
  check("UI 채택 → 예정 활동 생성 · 재전송 중복 방지 · 오래된 검토/변조 재시도 거절");

  const afterProject = await api(projectPath);
  assert.equal(afterProject.links.filter(link => link.salesProjectId === salesProjectId).length, 1);
  assert.equal(afterProject.actions.filter(action => action.actionId === actionId).length, 1);
  assert.equal(afterProject.actions.filter(action => action.title === actionTitle).length, 1);
  const acceptedAction = afterProject.actions.find(action => action.actionId === actionId);
  assert.equal(acceptedAction.status, "accepted");
  assert.equal(acceptedAction.salesActivityId, accepted.result.activityId);
  assert.equal(afterProject.project.region, initial.project.region);
  const finalSales = await api(`/api/local-demo/sales/${salesProjectId}`);
  assert.equal(finalSales.activities.length, 1);
  assert.equal(finalSales.activities[0].activityId, accepted.result.activityId);
  assert.equal(finalSales.activities[0].status, "planned");
  assert.equal(finalSales.activities[0].activityType, "email");
  assert(finalSales.activities[0].summary.includes(actionTitle));
  assert(finalSales.activities[0].summary.includes(projectId));
  await page.reload();
  await page.getByRole("row").filter({ hasText: actionTitle }).getByRole("link", { name: "영업건 보기", exact: true }).click();
  await page.waitForURL(`${base}/sales/${salesProjectId}`);
  await page.getByRole("heading", { name: "영업 연결 결과", exact: true }).waitFor();
  await page.getByText(salesTitle, { exact: true }).waitFor();
  await page.getByRole("row").filter({ hasText: actionTitle }).waitFor();
  await screenshot("05-persisted-sales-activity-light");
  await page.reload();
  await page.getByRole("row").filter({ hasText: actionTitle }).waitFor();
  await page.getByRole("button", { name: "다크 모드", exact: true }).click();
  await screenshot("06-persisted-sales-activity-dark");
  check("새로고침 뒤 영업건·연결·담당 활동 1건 보존 및 라이트·다크 표시");

  const finalMeta = await api("/api/local-demo/meta");
  assert.deepEqual(finalMeta.lastAiCall, baseline.lastAiCall, "검증 중 AI 호출이 발생하지 않아야 합니다.");
  assert.equal(finalMeta.counts.briefings, baseline.counts.briefings);
  assert.deepEqual(finalMeta.import, baseline.import, "원본 재수집을 호출하지 않아야 합니다.");
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, [], "외부 요청 또는 허용 범위 밖의 변경 요청이 있었습니다.");
  record.aiAfter = finalMeta.lastAiCall;
  record.saved = { sales: finalSales.project, activities: finalSales.activities, action: acceptedAction };
  check("AI 호출·수집 갱신·외부 접속 없음 및 브라우저 오류 없음");
  record.status = "passed";
} catch (error) {
  record.status = "failed";
  record.error = error instanceof Error ? error.stack : String(error);
  if (page) await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  console.error(record.error);
  process.exitCode = 1;
} finally {
  record.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, "result.json"), JSON.stringify(record, null, 2) + "\n");
  await browser?.close();
  console.log(`검증 기록: ${resolve(output, "result.json")}`);
}
