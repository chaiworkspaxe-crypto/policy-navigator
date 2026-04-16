import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script"; // 🌟 [Phase 4] 구글 애널리틱스 연동을 위한 Script 임포트
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 🌟 [추가] 모바일 최적화: iOS 사파리에서 인풋창 클릭 시 화면 강제 확대 방지
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "정책 내비게이터 | 나에게 딱 맞는 맞춤형 정부 혜택 찾기",
  description: "거주지와 출생연도만 입력하면 나에게 딱 맞는 청년 정책, 월세 지원, 취업 지원금, 장학금 등 정부 맞춤 혜택을 AI가 실시간으로 찾아드립니다.",
  keywords: ["청년 정책", "월세 지원", "청년 적금", "취업 지원금", "국비 지원", "대학생 장학금", "정부 혜택", "정책 내비게이터"],
  openGraph: {
    title: "정책 내비게이터 | 맞춤형 정부 혜택 찾기",
    description: "놓치고 있던 내 몫의 정부 혜택, AI가 10초 만에 찾아드려요! 🎁",
    url: "https://policyai.kr", // 🌟 도메인 변경 완료
    siteName: "정책 내비게이터",
    locale: "ko_KR",
    type: "website",
    // 🌟 [추가] 카톡/슬랙 공유 썸네일 이미지 설정
    images: [{ url: "https://policyai.kr/og-image.png", width: 1200, height: 630, alt: "정책 내비게이터 썸네일" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "정책 내비게이터 | 맞춤형 정부 혜택 찾기",
    description: "놓치고 있던 내 몫의 정부 혜택, AI가 10초 만에 찾아드려요! 🎁",
  },
  // 🌟 [핵심 수정] 16x16, 32x32 두 가지 사이즈의 파비콘을 모두 등록하여 최적화 완료!
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
  },
  // 🌟 [최종 삽입] 구글과 네이버의 소유권 확인 코드 적용 완료!
  verification: {
    google: "o4xskzx_MZmnxwxuP7UNSZ1uAP_bjH6BuGBq8dMCrkE",
    other: { "naver-site-verification": ["196916b6176cc9eca7f3fb5f15b0f1826e7df031"] },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* 🌟 [Phase 4] 구글 애널리틱스(GA4) 추적 스크립트 세팅 완료 */}
        <Script strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=G-EH957MVS6T`} />
        <Script
          id="google-analytics"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-EH957MVS6T', {
                page_path: window.location.pathname,
              });
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}
