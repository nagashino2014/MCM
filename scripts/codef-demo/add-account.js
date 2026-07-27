// 나머지 은행을 기존 connectedId에 추가 등록 (동일 범용 법인 공동인증서)
//   실행: node scripts/codef-demo/add-account.js [demo|sandbox]
//   기본 추가 대상: 기업·국민·신한·우리·농협 (하나는 create-account.js로 이미 등록됨)
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEnv, requestToken, requestProduct, publicEncRSA, ORG } = require('./codef');

const ADD_PATH = '/v1/account/add';
const BANKS = ['ibk', 'kb', 'shinhan', 'woori', 'nh']; // codef.js ORG 키

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'demo').toLowerCase();
  const prefix = env === 'sandbox' ? 'SANDBOX' : 'DEMO';
  const clientId = process.env[`CODEF_${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`CODEF_${prefix}_CLIENT_SECRET`];
  const pubKey = process.env.CODEF_PUBLIC_KEY;
  // 인증서 항목은 범용(HANA_* 이름을 공통 인증서로 재사용)
  const derFile = fs.readFileSync(process.env.HANA_CERT_DER_PATH).toString('base64');
  const keyFile = fs.readFileSync(process.env.HANA_CERT_KEY_PATH).toString('base64');
  const encPw = publicEncRSA(pubKey, process.env.HANA_CERT_PASSWORD);

  const idPath = path.join(__dirname, '.connected-id.json');
  const { connectedId } = JSON.parse(fs.readFileSync(idPath, 'utf8'));

  const accountList = BANKS.map((k) => ({
    countryCode: 'KR',
    businessType: 'BK',
    clientType: 'B',
    organization: ORG[k],
    loginType: '0',
    password: encPw,
    derFile,
    keyFile,
  }));

  const tok = await requestToken(clientId, clientSecret);
  console.log(`[${env}] 은행 추가 등록 → ${ADD_PATH}  connectedId=${connectedId}`);
  console.log('  대상:', BANKS.map((k) => `${k}(${ORG[k]})`).join(', '));

  const { httpStatus, json } = await requestProduct(env, ADD_PATH, tok.access_token, {
    connectedId,
    accountList,
  });
  console.log('  HTTP', httpStatus, '| result.code:', json?.result?.code, '|', json?.result?.message);
  console.log('\n--- data(기관별 결과) ---');
  console.log(JSON.stringify(json?.data, null, 2)?.slice(0, 2000));
  console.log('\n다음: node scripts/codef-demo/test-transaction.js demo <ibk|kb|shinhan|woori|nh>');
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
