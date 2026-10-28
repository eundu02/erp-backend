// PostgreSQL 연결 풀. 환경변수(PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD)는
// pg 라이브러리가 자동으로 읽으므로 별도 설정 객체 없이 new Pool()만으로 충분하다.
require('dotenv').config();
const { Pool, types } = require('pg');

// DATE(oid 1082) 컬럼은 JS Date로 바꾸지 않고 'YYYY-MM-DD' 문자열 그대로 반환한다.
// (Date로 바꾸면 JSON 직렬화 시 UTC로 변환되어 한국 시간 기준 하루 전 날짜처럼 보임)
types.setTypeParser(1082, (value) => value);

const pool = new Pool();

pool.on('error', (err) => {
  // 유휴 커넥션에서 발생하는 예기치 않은 에러 — 서버 전체를 죽이지 않고 로그만 남긴다.
  console.error('[DB] 예기치 않은 풀 에러:', err);
});

module.exports = pool;
