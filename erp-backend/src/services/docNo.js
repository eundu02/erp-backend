// 전표 번호 자동 생성: <접두어>-<YYYYMMDD>-<PK 5자리> (예: SO-20261015-00012)
// PK 시퀀스 값을 먼저 받아서 번호를 만들고, INSERT 시 같은 PK를 명시적으로 넣는다.
// (시퀀스 기반이라 동시 요청에도 중복되지 않음)
async function nextIdAndNo(client, table, idColumn, prefix) {
  const { rows } = await client.query(
    `SELECT nextval(pg_get_serial_sequence($1, $2))::int AS id,
            to_char(CURRENT_DATE, 'YYYYMMDD') AS ymd`,
    [table, idColumn]
  );
  const { id, ymd } = rows[0];
  return { id, no: `${prefix}-${ymd}-${String(id).padStart(5, '0')}` };
}

module.exports = { nextIdAndNo };
