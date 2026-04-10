import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 잘못된 옵션을 제거하여 터미널 경고(Warning)를 깔끔하게 없앱니다.
  // CORS는 백엔드(FastAPI)에서 컨트롤하는 것이 올바른 아키텍처입니다.
};

export default nextConfig;