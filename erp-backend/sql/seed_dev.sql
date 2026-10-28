-- 개발용 기본 사용자. 인증이 없는 v1에서 sales/purchase_orders.created_by(NOT NULL FK)에 쓸 user_id=1을 만든다.
-- password_hash는 로그인 기능 구현 전까지 쓰이지 않는 자리표시자.
INSERT INTO app_users (username, password_hash, full_name, role)
VALUES ('dev', 'not-used-yet', '개발자', 'admin')
ON CONFLICT (username) DO NOTHING;
