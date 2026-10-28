require('dotenv').config();
const app = require('./app');

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`[ERP backend] http://localhost:${port} 에서 실행 중`);
});
