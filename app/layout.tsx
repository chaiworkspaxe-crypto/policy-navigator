import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  icons: {
    icon: "/favicon.ico",
  },
  // 🌟 [추가] 구글/네이버 검색 엔진 등록용 메타태그 (값은 나중에 발급받아서 넣기)
  verification: {
    google: "여기에_구글_콘솔_코드를_넣을거야",
    other: { "naver-site-verification": ["여기에_네이버_코드를_넣을거야"] },
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
