const pool = require('../db/pool');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function list(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM suppliers ORDER BY supplier_id'
  );
  res.json(rows);
}

async function getOne(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM suppliers WHERE supplier_id = $1',
    [req.params.id]
  );
  if (rows.length === 0) throw httpError(404, '공급업체를 찾을 수 없습니다.');
  res.json(rows[0]);
}

async function create(req, res) {
  const { supplier_name, contact_name, phone, email, address, is_active } = req.body;
  if (!supplier_name) throw httpError(400, 'supplier_name은 필수입니다.');

  const { rows } = await pool.query(
    `INSERT INTO suppliers (supplier_name, contact_name, phone, email, address, is_active)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, true))
     RETURNING *`,
    [supplier_name, contact_name ?? null, phone ?? null, email ?? null, address ?? null, is_active]
  );
  res.status(201).json(rows[0]);
}

async function update(req, res) {
  // 담당자·연락처 등 선택 항목은 null(또는 빈 문자열)로 비울 수 있어야 하므로,
  // COALESCE 대신 기존 행을 읽어 바디에 있는 키만 덮어쓴다 (productsController.update와 같은 방식).
  const { rows: existing } = await pool.query('SELECT * FROM suppliers WHERE supplier_id = $1', [req.params.id]);
  if (existing.length === 0) throw httpError(404, '공급업체를 찾을 수 없습니다.');
  const current = existing[0];

  const pick = (key) => (key in req.body ? req.body[key] : current[key]);
  const optional = (key) => {
    const v = pick(key);
    return typeof v === 'string' && v.trim() === '' ? null : v;
  };

  const supplierName = pick('supplier_name');
  if (!supplierName || !String(supplierName).trim()) throw httpError(400, 'supplier_name은 비울 수 없습니다.');

  const { rows } = await pool.query(
    `UPDATE suppliers SET
       supplier_name = $1, contact_name = $2, phone = $3, email = $4, address = $5, is_active = $6
     WHERE supplier_id = $7
     RETURNING *`,
    [supplierName, optional('contact_name'), optional('phone'), optional('email'), optional('address'),
      pick('is_active'), req.params.id]
  );
  res.json(rows[0]);
}

async function remove(req, res) {
  const { rows } = await pool.query(
    'DELETE FROM suppliers WHERE supplier_id = $1 RETURNING supplier_id',
    [req.params.id]
  );
  if (rows.length === 0) throw httpError(404, '공급업체를 찾을 수 없습니다.');
  res.status(204).send();
}

module.exports = { list, getOne, create, update, remove };
