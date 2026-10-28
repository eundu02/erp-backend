// 전체 API 검증 실행기 — `npm test`
// 1) 별도 테스트 DB(erp_test)를 새로 만들고 스키마·개발 사용자를 넣는다
// 2) 테스트 DB를 바라보는 API 서버를 4001번 포트로 띄운다
// 3) 검증 스위트를 차례로 실행한다 (스위트마다 DB를 비워 빈 상태에서 시작)
// 4) 서버를 끄고 테스트 DB를 삭제한다
// 운영·시연용 DB(.env의 PGDATABASE)는 건드리지 않는다.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const TEST_DB = process.env.TEST_DB || 'erp_test';
const PORT = process.env.TEST_PORT || '4001';
const API = `http://localhost:${PORT}/api`;
const SUITES = [
  ['기본 ERP (재고·판매·발주·입고)', 'e2e-erp.js'],
  ['발주 추천·관리자 판단·발주 전환', 'e2e-recommendation.js'],
  ['유지보수 기능 (트랜잭션·항목 비우기·작성중 전표 삭제)', 'e2e-maintenance.js'],
  ['이력 조회 기간·이전 판단·사후 평가', 'e2e-decision-history.js'],
];

if (TEST_DB === process.env.PGDATABASE) {
  console.error(`테스트 DB 이름(${TEST_DB})이 .env의 PGDATABASE와 같습니다. 운영 DB를 지울 수 있어 중단합니다.`);
  process.exit(1);
}

async function adminQuery(sql) {
  const c = new Client({ database: 'postgres' });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

async function testQuery(sql) {
  const c = new Client({ database: TEST_DB });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

const TABLES = `app_users, suppliers, products, sales, sale_items, purchase_orders, purchase_order_items,
  receipts, receipt_items, inventory_balances, stock_movements, replenishment_recommendations, recommendation_decisions`;

async function createTestDb() {
  await adminQuery(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await adminQuery(`CREATE DATABASE ${TEST_DB}`);
  await testQuery(fs.readFileSync(path.join(ROOT, 'sql', 'erp_schema.sql'), 'utf8'));
}

async function resetTestDb() {
  await testQuery(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
  await testQuery(fs.readFileSync(path.join(ROOT, 'sql', 'seed_dev.sql'), 'utf8'));
}

async function waitForHealth(timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${API}/health`);
      if (r.ok) return;
    } catch { /* 서버 기동 중 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('테스트 서버가 응답하지 않습니다.');
}

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      cwd: ROOT,
      env: { ...process.env, TEST_API_BASE: API, TEST_DB },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

(async () => {
  let server;
  const results = [];
  try {
    console.log(`테스트 DB(${TEST_DB}) 생성 중…`);
    await createTestDb();

    server = spawn(process.execPath, ['src/server.js'], {
      cwd: ROOT,
      env: { ...process.env, PGDATABASE: TEST_DB, PORT },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    server.stderr.on('data', () => {}); // 의도된 4xx 응답의 에러 로그는 출력하지 않음
    await waitForHealth();

    for (const [name, file] of SUITES) {
      await resetTestDb();
      console.log(`\n■ ${name}`);
      results.push([name, await runSuite(file)]);
    }
  } catch (err) {
    console.error('검증 실행 실패:', err.message);
    results.push(['실행기', false]);
  } finally {
    if (server) server.kill();
    await new Promise((r) => setTimeout(r, 300));
    await adminQuery(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`).catch(() => {});
  }

  console.log('\n=== 요약 ===');
  for (const [name, ok] of results) console.log(`${ok ? '통과' : '실패'}  ${name}`);
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
})();
