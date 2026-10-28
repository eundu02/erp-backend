# ERP Frontend (React + Vite + Ant Design)

재고·발주 ERP 관리자 화면. 실무 ERP/백오피스에서 가장 흔한 **좌측 사이드 메뉴 + 상단 헤더 + 테이블/폼 + 상세 Drawer** 구성입니다.

## 실행

```bash
# 1) 백엔드 먼저 실행 (../erp-backend)
cd ../erp-backend && npm run dev        # http://localhost:4000

# 2) 프론트엔드
cd ../erp-frontend
npm install
npm run dev                             # http://localhost:5173
```

`/api` 요청은 Vite 개발 서버가 백엔드(4000번)로 프록시합니다 (`vite.config.js`).

## 화면

| 메뉴 | 경로 | 주요 기능 |
|---|---|---|
| 대시보드 | `/` | KPI(안전재고 미달·진행 중 발주·미입고 수량·미확정 판매), 14일 판매 추이, 미달 품목, 입고 대기 발주, 최근 재고 변동 |
| 상품 관리 | `/products` | 목록·검색·등록·수정·삭제, 사용 여부 토글, 발주 조건(납기·MOQ·배수·안전재고) |
| 공급업체 관리 | `/suppliers` | 목록·검색·등록·수정·삭제 |
| 재고 현황 | `/inventory` | 현재고·안전재고·미입고·재고 위치, 미달 필터, 행 클릭 시 상품별 변동 이력 |
| 재고 변동 이력 | `/stock-movements` | 원장 조회 (상품·유형 필터), 취소 행은 ↩ 표시 |
| 판매 관리 | `/sales` | 전표 작성(다품목) → 확정(재고 차감) / 취소(반대 부호 복원), 재고 부족 시 품목별 안내 |
| 발주 관리 | `/purchase-orders` | 발주서 작성(공급업체별 품목 필터, MOQ·배수 경고) → 확정 → 입고 등록, 품목별 입고 진행률 |
| 발주 추천 | `/recommendations` | 추천 계산 실행, 상품별 P50/P70/P90 권장량 비교(기본 전략 강조), 계산 근거(실적/계획 납기·표본 수, 보호기간, 이력 충분 여부), 상세에서 전략 비교 카드·일별 판매·판단 입력(수정 시 사유 필수)·반려, 판단 확정 건 선택 → 공급업체별 발주서 일괄 전환 |
| 입고 관리 | `/receipts` | 발주서 기준 부분 입고 등록(잔량 기본 입력) → 확정(재고 증가) |

## 구조

```
src/
  main.jsx            ConfigProvider(한국어 로케일, 테마), 라우터
  App.jsx             라우트 정의
  layouts/AppLayout   사이드 메뉴 + 헤더 + 브레드크럼
  pages/              화면별 컴포넌트
  components/         StatusTag, MovementTable, ReceiptCreateModal, DailySalesChart, PageHeader
  api/client.js       fetch 래퍼 (서버 { error, detail } → ApiError)
  hooks/useApi.js     조회 + 로딩 + 에러 메시지 + reload
  config.js           현재 사용자 (인증 미구현 — user_id=1 고정)
```
