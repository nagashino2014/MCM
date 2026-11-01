import { build } from "esbuild";
import { spawnSync } from "node:child_process";

// 분류기·수집기의 실제 코드는 실행하되 외부 AI/검색/DB 경계는 반드시 메모리 대역으로 바꾼다.
const mocks = {
  "@/lib/ai/claude-client": `export const claudeMessages = request => globalThis.__newsHarness.invoke(request);`,
  "@/lib/db": `export const getDb = async () => globalThis.__newsHarness.db; export const rowsToObjects = value => value; export const withDbWrite = fn => fn(globalThis.__newsHarness.db);`,
  "./facility-matcher": `export const buildFacilityMatcher = async () => ({matchName: () => null});`,
  "./industry-rules": `export const EMPTY_INDUSTRY_TAG = {industry:null,relevance:null,note:null}; export const industryTagForFacility = async () => EMPTY_INDUSTRY_TAG;`,
  "./intel-feedback": `export const feedbackKey = (source,id) => source+':'+id; export const formatFeedbackExamples = () => ''; export const loadFeedbackBlocklist = async () => new Set(); export const loadFeedbackExamples = async () => [];`,
  "./naver-news-client": `export const searchNews = keyword => globalThis.__newsHarness.search(keyword);`,
  "./press-client": `export const fetchUlsanList = () => globalThis.__newsHarness.pressList(); export const fetchJeonnamList = async () => []; export const fetchGyeongbukList = fetchJeonnamList; export const fetchChungnamList = fetchJeonnamList; export const fetchGyeonggiList = fetchJeonnamList; export const fetchGyeongnamList = fetchJeonnamList; export const fetchJeonbukList = fetchJeonnamList; export const fetchMceeRss = fetchJeonnamList; export const fetchPressBody = item => globalThis.__newsHarness.pressBody(item); export const PRESS_SOURCE_LABELS = {ulsan:'울산시'};`,
  "./intel-settings": `export const INTEL_COLLECT_DEFAULTS = {press:{titleKeywords:['공장'],deptKeywords:['투자']}}; export const isOlderThanCutoff = () => false;`,
};
await build({ entryPoints: ["tests/news-content-quality.test.ts"], outfile: ".next/news-content-quality-tests/test.cjs", bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json", plugins: [{name:"offline-boundaries",setup(build){
  build.onResolve({filter:/.*/},args => Object.hasOwn(mocks,args.path) ? {path:args.path,namespace:"news-test-boundary"} : undefined);
  build.onLoad({filter:/.*/,namespace:"news-test-boundary"},args => ({contents:mocks[args.path],loader:"js"}));
}}] });
const result = spawnSync(process.execPath,["--test",".next/news-content-quality-tests/test.cjs"],{stdio:"inherit",env:{...process.env,ANTHROPIC_API_KEY:"offline-test-not-a-real-key"}});
process.exitCode = result.status ?? 1;
