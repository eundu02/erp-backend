// async 라우트 핸들러의 reject를 자동으로 next(err)로 넘겨주는 래퍼.
// 매 라우트마다 try/catch를 반복하지 않기 위함.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
