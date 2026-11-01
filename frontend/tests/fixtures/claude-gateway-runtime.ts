/** 게이트웨이 요청 경계 시험 전용. 실제 DB·비용 알림·외부 전송은 포함하지 않는다. */
type Row = Record<string, unknown>;
export const gatewayFixture = { settings: {} as Row, reads: [] as string[], forbidden: [] as string[], usage: [] as Row[] };
export function resetGatewayFixture(settings: Row = {}) { gatewayFixture.settings=settings;gatewayFixture.reads=[];gatewayFixture.forbidden=[];gatewayFixture.usage=[]; }
export async function getDb() {
  return { async exec(sql: string) {
    gatewayFixture.reads.push(sql);
    if(sql === "SELECT setting_key, setting_json FROM ai_settings") return Object.entries(gatewayFixture.settings).map(([setting_key,setting_json])=>({setting_key,setting_json}));
    if(sql.includes("FROM ai_model_prices")) return [];
    gatewayFixture.forbidden.push(sql);throw new Error("시험에서 허용하지 않은 DB 호출");
  }, async run(sql:string) {gatewayFixture.forbidden.push(sql);throw new Error("시험 DB 쓰기는 허용하지 않습니다.");} };
}
export function rowsToObjects(rows: Row[]): Row[] { return rows; }
export async function withDbWrite() { gatewayFixture.forbidden.push("withDbWrite");throw new Error("시험 DB 쓰기는 허용하지 않습니다."); }
export function currentAiEnv() { return "test"; }
export async function logAiUsage(row:Row) { gatewayFixture.usage.push(row);return "fixture-log"; }
export async function budgetGate() { return {blocked:false,reason:null}; }
export async function getOrgBudgetPct() { return null; }
export async function afterCallBudgetCheck() { /* 외부 예산 알림을 실행하지 않는 시험 double */ }
