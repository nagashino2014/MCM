/**
 * 웹 미리보기용 API 중계 프록시 — **개발 전용**.
 *
 * 왜 필요한가: `npx expo start --web` 으로 띄운 미리보기는 브라우저에서 도는데,
 * 브라우저는 다른 오리진(https://koensain.app)으로의 fetch 를 CORS 로 막는다.
 * 네이티브 앱에는 CORS 가 없어 실기기에서는 겪지 않는 문제다.
 * 서버에 CORS 를 여는 대신(운영에 구멍을 내지 않는다) 로컬에서만 도는 중계를 둔다.
 *
 * 실행:  node scripts/dev-api-proxy.mjs            (기본 staging 중계, 8082 포트)
 *        TARGET=http://localhost:3001 node scripts/dev-api-proxy.mjs
 * 사용:  EXPO_PUBLIC_API_URL=http://localhost:8082 로 웹 미리보기를 띄운다.
 *
 * ⚠ 로그인 자격증명이 이 프로세스를 지나간다. 로컬 루프백에만 바인딩하고(127.0.0.1),
 *   미리보기 확인이 끝나면 내린다. 앱 번들에는 들어가지 않는다(scripts/ 는 번들 대상이 아님).
 */
import http from 'node:http';

const TARGET = process.env.TARGET ?? 'https://koensain.app';
const PORT = Number(process.env.PORT ?? 8082);

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '600',
});

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
  });

const server = http.createServer(async (req, res) => {
  const cors = corsHeaders(req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  try {
    const body = await readBody(req);
    const headers = {};
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const upstream = await fetch(`${TARGET}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      redirect: 'manual',
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const out = { ...cors };
    const ct = upstream.headers.get('content-type');
    if (ct) out['content-type'] = ct;
    res.writeHead(upstream.status, out);
    res.end(buf);
  } catch (err) {
    res.writeHead(502, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `프록시 실패: ${err?.message ?? err}` }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-api-proxy] http://localhost:${PORT}  →  ${TARGET}`);
});
