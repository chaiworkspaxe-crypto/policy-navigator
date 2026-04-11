import type { Metadata } from "next";
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

// 🌟 [핵심] 검색 엔진과 카카오톡 공유를 위한 SEO 메타데이터 세팅
export const metadata: Metadata = {
  title: "정책 내비게이터 | 나에게 딱 맞는 맞춤형 정부 혜택 찾기",
  description: "거주지와 출생연도만 입력하면 나에게 딱 맞는 청년 정책, 월세 지원, 취업 지원금, 장학금 등 정부 맞춤 혜택을 AI가 실시간으로 찾아드립니다.",
  keywords: ["청년 정책", "월세 지원", "청년 적금", "취업 지원금", "국비 지원", "대학생 장학금", "정부 혜택", "정책 내비게이터"],
  openGraph: {
    title: "정책 내비게이터 | 맞춤형 정부 혜택 찾기",
    description: "놓치고 있던 내 몫의 정부 혜택, AI가 10초 만에 찾아드려요! 🎁",
    url: "https://policy-navigator-lac.vercel.app", // 창현이의 Vercel 도메인
    siteName: "정책 내비게이터",
    locale: "ko_KR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "정책 내비게이터 | 맞춤형 정부 혜택 찾기",
    description: "놓치고 있던 내 몫의 정부 혜택, AI가 10초 만에 찾아드려요! 🎁",
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 🌟 [수정] lang="en"을 lang="ko"로 변경 (한국어 사이트임을 검색 엔진에 알림)
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
