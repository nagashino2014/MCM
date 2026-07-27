// 카드사를 기존 connectedId에 추가 등록 (카드사 웹 ID/PW 방식, loginType '1')
//   실행: node scripts/codef-demo/add-card.js [demo|sandbox]
//   대상: 롯데카드(0304), BC카드(0311). 로그인 정보는 .env CARD_WEB_ID / CARD_WEB_PW.
'use strict';
const fs = require('fs');
const path = require('path');
const { loadEnv, requestToken, requestProduct, publicEncRSA, CARD } = require('./codef');

const ADD_PATH = '/v1/account/add';
const CARDS = ['lotte', 'bc'];

(async () => {
  loadEnv();
  const env = (process.argv[2] || 'demo').toLowerCase();
  const prefix = env === 'sandbox' ? 'SANDBOX' : 'DEMO';
  const clientId = process.env[`CODEF_${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`CODEF_${prefix}_CLIENT_SECRET`];
  const pubKey = process.env.CODEF_PUBLIC_KEY;
  const cardId = process.env.CARD_WEB_ID;
  const cardPw = process.env.CARD_WEB_PW;
  if (!cardId || !cardPw) { console.error('❌ .env CARD_WEB_ID / CARD_WEB_PW 필요'); process.exit(1); }

  const { connectedId } = JSON.parse(
    fs.readFileSync(path.join(__dirname, '.connected-id.json'), 'utf8'),
  );

  // 카드사 웹 로그인(ID/PW). 비밀번호는 public_key로 RSA 암호화.
  const accountList = CARDS.map((k) => ({
    countryCode: 'KR',
    businessType: 'CD',       // 카드
    clientType: 'B',          // 법인
    organization: CARD[k],
    loginType: '1',           // 1 = ID/PW
    id: cardId,
    password: publicEncRSA(pubKey, cardPw),
  }));

  const tok = await requestToken(clientId, clientSecret);
  console.log(`[${env}] 카드사 추가 등록(ID/PW) → ${ADD_PATH}  connectedId=${connectedId}`);
  console.log('  대상:', CARDS.map((k) => `${k}(${CARD[k]})`).join(', '));

  const { httpStatus, json } = await requestProduct(env, ADD_PATH, tok.access_token, {
    connectedId,
    accountList,
  });
  console.log('  HTTP', httpStatus, '| result.code:', json?.result?.code, '|', json?.result?.message);
  console.log('\n--- data(기관별 결과) ---');
  console.log(JSON.stringify(json?.data, null, 2)?.slice(0, 2500));
})().catch((e) => { console.error('❌ 실패:', e.message); process.exit(1); });
