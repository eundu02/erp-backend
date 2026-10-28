const httpError = require('./httpError');

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function requirePositiveInt(value, name) {
  if (!isPositiveInt(value)) throw httpError(400, `${name}는 1 이상의 정수여야 합니다.`);
  return value;
}

function requireNonEmptyArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw httpError(400, `${name}는 1개 이상의 항목을 가진 배열이어야 합니다.`);
  }
  return value;
}

module.exports = { isPositiveInt, requirePositiveInt, requireNonEmptyArray };
