// 공통 에러 핸들링 미들웨어. PostgreSQL 에러 코드를 적절한 HTTP 상태로 변환한다.
// 참고: https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_CONSTRAINT_CODES = new Set([
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
  '23502', // not_null_violation
]);

function notFound(req, res) {
  res.status(404).json({ error: '요청한 경로를 찾을 수 없습니다.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err);

  if (err.status) {
    // 라우트에서 의도적으로 던진 에러 (예: 404, 400, 재고 부족 409)
    const body = { error: err.message };
    if (err.detail !== undefined) body.detail = err.detail;
    return res.status(err.status).json(body);
  }

  if (err.code && PG_CONSTRAINT_CODES.has(err.code)) {
    return res.status(409).json({
      error: '제약조건 위반(존재하지 않는 참조, 중복값, 또는 필수값 누락 등)',
      detail: err.detail || err.message,
    });
  }

  res.status(500).json({ error: '서버 오류가 발생했습니다.', detail: err.message });
}

module.exports = { errorHandler, notFound };
