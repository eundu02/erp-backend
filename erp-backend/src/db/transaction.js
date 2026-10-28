const pool = require('./pool');

// 하나의 커넥션에서 BEGIN ~ COMMIT을 수행한다. fn이 throw하면 ROLLBACK 후 에러를 다시 던진다.
// 재고 차감/증가처럼 여러 테이블을 함께 바꿔야 하는 작업은 반드시 이 안에서 처리한다.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = withTransaction;
