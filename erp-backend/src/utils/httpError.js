// 라우트에서 의도적으로 던지는 HTTP 에러 (errorHandler가 err.status를 그대로 응답 코드로 사용).
module.exports = function httpError(status, message, detail) {
  const err = new Error(message);
  err.status = status;
  if (detail !== undefined) err.detail = detail;
  return err;
};
