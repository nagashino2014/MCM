// 바로빌 SOAP 연동 최소 헬퍼 (외부 의존성 없음 — Node 18+ 내장 fetch)
// 바로빌은 .asmx SOAP 웹서비스. 인증 = CERTKEY(연동인증키) + CorpNum(사업자번호) + ID(바로빌 회원 아이디).
//   서비스: BANKACCOUNT.asmx(계좌), CARD.asmx(카드), TI.asmx(세금계산서) 등
//   반환값이 "음수(다섯자리)"면 오류코드. GetErrString으로 메시지 조회.
// 키/자격은 .env 에서만 읽는다(코드에 하드코딩 금지).

'use strict';
const fs = require('fs');
const path = require('path');

// --- .env 로더 (dotenv 없이 최소 파싱) ---
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env 없음. .env.example 복사 후 채우세요: ' + envPath);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// --- 엔드포인트 (테스트베드 / 운영) ---
const HOSTS = {
  test: 'https://testws.baroservice.com',
  prod: 'https://ws.baroservice.com',
};
const NS = 'http://tempuri.org/';

// --- 은행코드 (우리 6개 + 자주 쓰는 것) ---
const BANK = {
  ibk: 'IBK', kb: 'KB', shinhan: 'SHINHAN', hana: 'HANA', woori: 'WOORI', nh: 'NH',
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// params는 삽입 순서 = 바로빌 파라미터 순서 그대로여야 함
function soapEnvelope(method, params) {
  const inner = Object.entries(params).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">${inner}</${method}>
  </soap:Body>
</soap:Envelope>`;
}

// SOAP 호출. service: 'BANKACCOUNT' | 'CARD' | 'TI' ...
async function call(env, service, method, params) {
  const host = HOSTS[env];
  if (!host) throw new Error('알 수 없는 env: ' + env + ' (test|prod)');
  const url = `${host}/${service}.asmx`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: NS + method },
    body: soapEnvelope(method, params),
  });
  const xml = await res.text();
  return { httpStatus: res.status, xml };
}

// --- 간단 XML 추출(의존성 없이) ---
// 단일 태그 값
function pick(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}
// 반복 요소들의 innerXML 배열 (예: <BankAccountEx>...</BankAccountEx> 여러 개)
function pickAll(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
// 메서드Result 내용
function result(xml, method) {
  return pick(xml, `${method}Result`);
}
// 반환이 음수 다섯자리(오류코드)인지
function isErrCode(v) {
  return typeof v === 'string' && /^-\d{1,5}$/.test(v.trim());
}

module.exports = { loadEnv, call, HOSTS, BANK, pick, pickAll, result, isErrCode };
