// 어드민 라우트들에서 미들웨어로 검증
// app/api/admin/_lib/checkAdmin.ts
export function checkAdmin(req: Request): boolean {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/admin_session=([^;]+)/);
  if (!match) return false;
  
  const provided = decodeURIComponent(match[1]);
  const adminKey = process.env.ADMIN_PASS_KEY;
  if (!adminKey) return false;
  
  return provided === adminKey;  // timingSafeEqual 권장
}
