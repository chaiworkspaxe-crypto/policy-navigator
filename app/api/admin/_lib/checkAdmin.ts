export function checkAdmin(req: Request) {
  const adminKey = process.env.ADMIN_PASS_KEY;
  
  if (!adminKey) {
    console.error("🚨 ADMIN_PASS_KEY 환경변수가 설정되지 않았습니다.");
    return false;
  }

  // 1. 브라우저 쿠키(Cookie)에서 방문증 확인 (가장 확실한 방법)
  const cookieHeader = req.headers.get('cookie') || '';
  if (cookieHeader.includes(`admin_session=${adminKey}`)) {
    return true;
  }

  // 2. 혹시 Axios(lib/api.ts)가 Authorization 헤더로 보냈을 경우 대비 (기존 방식 호환)
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader === `Bearer ${adminKey}` || authHeader === adminKey) {
    return true;
  }

  // 3. 커스텀 헤더 확인 (혹시 몰라서 추가)
  const customHeader = req.headers.get('x-admin-key') || '';
  if (customHeader === adminKey) {
    return true;
  }

  // 위 3개 중에 아무것도 없으면 얄짤없이 차단! (403 에러 발생)
  return false;
}
