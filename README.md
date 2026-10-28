# 재고·발주 ERP

소규모 유통업을 위한 재고·발주 관리 시스템. 기본 ERP(재고·판매·발주·부분 입고)에 규칙 기반 발주 추천
(부트스트랩 P50/P70/P90, 공급업체 실적 납기)과 관리자 판단 이력을 결합했다.

| 폴더 | 내용 |
|---|---|
| [erp-backend](erp-backend/) | REST API 서버 (Node.js · Express · PostgreSQL). API 명세는 `erp-backend/API_SPEC.md` |
| [erp-frontend](erp-frontend/) | 관리자 화면 (React · Vite · Ant Design) |
| [ppt-images](ppt-images/) | 발표용 화면 캡처 |

## 빠른 실행

```bash
cd erp-backend && npm install && npm run dev      # http://localhost:4000 (PostgreSQL·.env 설정 필요, erp-backend/README.md 참고)
cd erp-frontend && npm install && npm run dev     # http://localhost:5173
cd erp-backend && npm test                        # 전체 API 검증 (별도 테스트 DB를 만들어 실행 후 삭제)
```
