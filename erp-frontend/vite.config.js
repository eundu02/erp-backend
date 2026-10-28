import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api 요청은 백엔드(Express, 4000번)로 프록시 → 브라우저 입장에서는 같은 출처라 CORS 설정 불필요
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
