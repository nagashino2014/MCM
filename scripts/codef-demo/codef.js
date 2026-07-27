// CODEF 데모 연동 최소 헬퍼 (외부 의존성 없음 — Node 18+ 내장 fetch/crypto 사용)
// 공식 SDK(codef-io/codef-node) 흐름을 순수 Node로 재현한 테스트용 모듈.
//   - OAuth: POST https://oauth.codef.io/oauth/token (Basic auth, client_credentials)
//   - API 바디: JSON을 URL 인코딩해 전송, 응답은 URL 인코딩 문자열 → decode 후 JSON.parse
// 키 값은 .env에서만 읽는다(코드에 하드코딩 금지).

'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- .env 로더 (dotenv 의존성 없이 최소 파싱) ---
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env 파일이 없습니다. .env.example을 복사해 키를 채우세요: ' + envPath);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// --- 환경별 API 호스트 ---
const HOSTS = {
  sandbox: 'https://sandbox.codef.io',
  demo: 'https://development.codef.io',
  prod: 'https://api.codef.io',
};

const OAUTH_URL = 'https://oauth.codef.io/oauth/token';

// --- 은행 organization 코드 (사용자 6개 은행) ---
const ORG = {
  ibk: '0003',   // 기업은행(주거래)
  kb: '0004',    // 국민
  shinhan: '0088', // 신한
  hana: '0081',  // 하나
  woori: '0020', // 우리
  nh: '0011',    // 농협
};

// --- 카드사 organization 코드 (CODEF 공식 코드표) ---
const CARD = {
  kb: '0301', hyundai: '0302', samsung: '0303', nh: '0304', bc: '0305',
  shinhan: '0306', citi: '0307', woori: '0309', lotte: '0311', hana: '0313',
  jeonbuk: '0315', gwangju: '0316', suhyup: '0320', jeju: '0321',
  // 기업은행 법인카드 = BC 매입 → bc(0305). 롯데 = 0311.
};

// --- OAuth 액세스 토큰 발급 ---
async function requestToken(clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=read',
  });
  const text = await res.text();
  if (res.status !== 200) {
    throw new Error(`토큰 발급 실패 HTTP ${res.status}: ${text}`);
  }
  return JSON.parse(text); // { access_token, token_type, expires_in }
}

// --- CODEF API 호출 (URL 인코딩 바디 / 응답 디코딩) ---
async function requestProduct(env, apiPath, token, body) {
  const host = HOSTS[env];
  if (!host) throw new Error(`알 수 없는 환경: ${env}`);
  const res = await fetch(host + apiPath, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    // CODEF 규칙: JSON 문자열 전체를 URL 인코딩해 전송
    body: encodeURIComponent(JSON.stringify(body)),
  });
  const raw = await res.text();
  // 응답도 URL 인코딩되어 옴 → 디코드 후 JSON 파싱.
  // CODEF는 공백을 '+'로 인코딩하므로 decodeURIComponent 전에 '+'→공백 치환.
  let decoded;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    decoded = raw; // 이미 평문인 경우
  }
  let json;
  try {
    json = JSON.parse(decoded);
  } catch {
    json = { _rawUndecoded: raw, _decoded: decoded };
  }
  return { httpStatus: res.status, json };
}

// --- 비밀번호 등 민감 파라미터 RSA 암호화(PKCS1) ---
function publicEncRSA(publicKey, plain) {
  const pem = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
  return crypto
    .publicEncrypt(
      { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(String(plain)),
    )
    .toString('base64');
}

module.exports = { loadEnv, requestToken, requestProduct, publicEncRSA, HOSTS, ORG, CARD };
