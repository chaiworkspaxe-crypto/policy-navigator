'use client';

import { useEffect, useState } from 'react';

export default function InAppGuide() {
  const [isInApp, setIsInApp] = useState(false);
  // 🌟 변경 1: 모달 닫기(무시) 상태 추가
  const [dismissed, setDismissed] = useState(false);
  const [os, setOs] = useState<'ios' | 'android' | 'other'>('other');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // 1. 유저 기기 및 브라우저 정보 가져오기
    const userAgent = navigator.userAgent.toLowerCase();
    
    // 2. 인스타, 카톡 등 대표적인 인앱 브라우저 키워드 감지
    const inAppKeywords = ['instagram', 'kakaotalk', 'line', 'fbav', 'fban'];
    const isApp = inAppKeywords.some(keyword => userAgent.includes(keyword));

    if (isApp) {
      setIsInApp(true);
      // 3. 아이폰(iOS)인지 안드로이드인지 판별
      if (userAgent.match(/iphone|ipad|ipod/i)) {
        setOs('ios');
      } else if (userAgent.match(/android/i)) {
        setOs('android');
      }
    }
  }, []);

  // 링크 복사 기능
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // 2초 뒤에 원래 글자로 복구
    } catch (err) {
      alert('링크 복사에 실패했습니다. 직접 주소창에서 복사해주세요!');
    }
  };

  // 🌟 변경 2: 인앱 브라우저가 아니거나, 사용자가 '그냥 사용하기'를 눌렀다면 모달을 숨김
  if (!isInApp || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm">
      <div className="bg-white p-8 rounded-2xl max-w-sm w-full shadow-2xl flex flex-col items-center animate-in fade-in zoom-in duration-300">
        
        <div className="text-6xl mb-4">🚨</div>
        
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          잠깐! AI 검색이 멈출 수 있어요
        </h2>
        
        {/* 기기별 맞춤 안내 메시지 영역 */}
        <div className="text-base mb-6 bg-gray-100 p-4 rounded-xl w-full text-gray-800">
          {os === 'ios' ? (
            <>
              <p>화면 하단(또는 상단)의 <strong className="text-blue-600">[ ⋯ ]</strong> 버튼을 누르고</p>
              <p className="mt-2"><strong className="text-blue-600">Safari에서 열기</strong>를 선택해 주세요!</p>
            </>
          ) : (
            <>
              <p>화면 우측 상단의 <strong className="text-blue-600">[ ⋮ ]</strong> 버튼을 누르고</p>
              <p className="mt-2"><strong className="text-blue-600">다른 브라우저에서 열기</strong>를 선택해 주세요!</p>
            </>
          )}
        </div>

        {/* 링크 복사 버튼 */}
        <button
          onClick={copyLink}
          className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-xl transition-colors"
        >
          {copied ? '✅ 복사 완료!' : '🌐 현재 링크 복사하기'}
        </button>

        {/* 🌟 변경 3: 강제 이탈 방지용 닫기(무시) 버튼 추가 */}
        <button 
          onClick={() => setDismissed(true)}
          className="mt-4 text-sm text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-2"
        >
          그냥 사용하기 (일부 기능 제한 가능)
        </button>
        
        <p className="text-xs text-gray-500 mt-4 break-keep">
          위 버튼을 눌러 주소를 복사한 후, 평소 쓰시는 인터넷 창(Safari, Chrome 등)에 붙여넣으셔도 됩니다.
        </p>
      </div>
    </div>
  );
}
