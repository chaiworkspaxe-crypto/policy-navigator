// 🌟 이 부분을 찾아서 아래 코드로 완전히 교체해주세요!
  useEffect(() => {
    const handleLogin = async () => {
      const password = window.prompt("관리자 비밀번호를 입력하세요.");
      
      if (!password) {
        window.location.href = "/";
        return;
      }

      try {
        // 🌟 [핵심 변경] 단순히 글자를 비교하는 게 아니라, 서버에 비밀번호를 보내서 '방문증(쿠키)'을 발급받습니다!
        const res = await fetch('/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        if (res.ok) {
          // 서버가 쿠키를 구워줬으므로 이제 인증 완료!
          setIsAdminAuthenticated(true);
          fetchStats(); // 이때부터 403 에러 없이 정상적으로 통계가 불러와집니다.
          document.documentElement.classList.add('dark');
        } else {
          alert("비밀번호가 틀렸거나 권한이 없습니다.");
          window.location.href = "/";
        }
      } catch (error) {
        alert("로그인 처리 중 서버 에러가 발생했습니다.");
        window.location.href = "/";
      }
    };

    handleLogin();
  }, []);
