/** @type {import('tailwindcss').Config} */
module.exports = {
  // 🌟 5번 기능(다크모드)을 위해 이 설정이 반드시 필요해!
  darkMode: 'class', 
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // 🌟 [핵심 개선] Next.js에서 로드한 폰트 CSS 변수를 Tailwind 기본 폰트로 매핑
      fontFamily: {
        // 한국어를 최우선으로, 그 다음 Geist(영문), 그 다음 시스템 기본 폰트 순으로 Fallback
        sans: ['var(--font-noto-kr)', 'var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
