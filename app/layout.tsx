// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_KR } from "next/font/google"; // 🌟 Noto_Sans_KR 추가
import Script from "next/script";
import InAppGuide from "@/components/InAppGuide"; 
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: 'swap', // 🌟 최적화
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: 'swap', // 🌟 최적화
});

// 🌟 [신규] 한국어 본문 폰트 최적화 로드
const notoKr = Noto_Sans_KR({
  variable: "--font-noto-kr",
  subsets: ["latin"],            // Latin만 prefetch (Korean은 unicode-range로 필요할 때 lazy load)
  weight: ['400', '500', '700'], // 필요한 굵기만 가져와서 용량 다이어트
  display: 'swap',               // FOUT 허용 (FOIT 방지 - 로딩 중에도 글자는 보이게)
});

// 🌟 모바일 최적화 및 접근성 개선
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
  // GA ID를 환경변수로 분리 (preview 환경의 통계 오염 방지)
  const gaId = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <html
      lang="ko"
      // 🌟 [핵심] HTML 클래스에 NotoSansKR 변수 추가
      className={`${geistSans.variable} ${geistMono.variable} ${notoKr.variable} h-full antialiased`}
    >
      <body className={`min-h-full flex flex-col font-sans`}>
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
                  gtag('config', '${gaId}', { page_path: window.location.pathname });
                `,
              }}
            />
          </>
        )}
        
        {/* 화면 최상단에 가이드 컴포넌트를 배치 (인앱일 때만 알아서 나타남!) */}
        <InAppGuide />

        {children}
      </body>
    </html>
  );
}
