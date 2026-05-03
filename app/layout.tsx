import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import InAppGuide from "@/components/InAppGuide";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 🌟 [수술 1️⃣5️⃣] 접근성 개선: userScalable을 허용하여 시각 약자의 핀치 줌 확대 보장
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "정책 내비게이터 | 나에게 딱 맞는 맞춤형 정부 혜택 찾기",
  description: "거주지와 출생연도만 입력하면 나에게 딱 맞는 청년 정책, 월세 지원, 취업 지원금, 장학금 등 정부 맞춤 혜택을 AI가 실시간으로 찾아드립니다.",
  keywords: ["청년 정책", "월세 지원", "청년 적금", "취업 지원금", "국비 지원", "대학생 장학금", "정부 혜택", "정책 내비게이터"],
  openGraph: {
    title: "정책 내비게이터 | 맞춤형 정부 혜택 찾기",
    description: "놓치고 있던 내 몫의 정부 혜택, AI가 10초 만에 찾아드려요! 🎁",
    url: "https://policyai.kr",
    siteName: "정책 내비게이터",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "https://policyai.kr/og-image.png", width: 1200, height: 630, alt: "정책 내비게이터 썸네일" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "정책 내비게이터 | 맞춤형 정부 혜택 찾기",
    description: "놓치고 있던 내 몫의 정부 혜택, AI가 10초 만에 찾아드려요! 🎁",
  },
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
  },
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
  // 🌟 [수술 1️⃣5️⃣] GA ID를 환경변수로 분리하여 Preview 환경의 통계 오염 방지
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* gaId가 환경변수에 설정된 경우에만 스크립트 로드 */}
        {gaId && (
          <>
            <Script 
              strategy="afterInteractive" 
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} 
            />
            <Script
              id="google-analytics"
              strategy="afterInteractive"
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());
                  gtag('config', '${gaId}', {
                    page_path: window.location.pathname,
                  });
                `,
              }}
            />
          </>
        )}
        
        <InAppGuide />
        {children}
      </body>
    </html>
  );
}
