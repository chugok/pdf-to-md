'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '로그인에 실패했습니다.');
        return;
      }
      router.push('/');
    } catch {
      setError('서버 연결에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Noto Sans KR', sans-serif;
          background: #0a0a0f; color: #e8e6e3; min-height: 100vh;
        }
        .auth-page {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: radial-gradient(ellipse at 20% 0%, rgba(59,130,246,0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 100%, rgba(168,85,247,0.06) 0%, transparent 50%), #0a0a0f;
          padding: 24px;
        }
        .auth-card {
          width: 100%; max-width: 380px;
          background: rgba(15,15,25,0.8); border: 1px solid rgba(100,116,139,0.15);
          border-radius: 16px; padding: 40px 32px; backdrop-filter: blur(10px);
          text-align: center;
        }
        .auth-badge {
          display: inline-block; padding: 6px 16px;
          background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.2);
          border-radius: 100px; font-size: 12px; font-weight: 500; color: #60a5fa;
          letter-spacing: 0.5px; margin-bottom: 20px;
        }
        .auth-title {
          font-size: 28px; font-weight: 700; margin-bottom: 8px;
          background: linear-gradient(135deg, #fff 0%, #94a3b8 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .auth-subtitle { font-size: 14px; color: #64748b; margin-bottom: 32px; }
        .form-input {
          width: 100%; padding: 14px 16px; border-radius: 10px;
          background: rgba(15,15,25,0.6); border: 1px solid rgba(100,116,139,0.2);
          color: #e2e8f0; font-size: 15px; font-family: 'Noto Sans KR', sans-serif;
          outline: none; transition: border-color 0.2s ease;
          text-align: center; letter-spacing: 1px; margin-bottom: 16px;
        }
        .form-input:focus { border-color: rgba(59,130,246,0.5); }
        .form-input::placeholder { color: #475569; letter-spacing: 0; }
        .auth-btn {
          width: 100%; padding: 13px; border-radius: 10px; font-size: 15px; font-weight: 600;
          font-family: 'Noto Sans KR', sans-serif; cursor: pointer; border: none;
          background: linear-gradient(135deg, #3b82f6, #2563eb); color: white;
          box-shadow: 0 4px 14px rgba(59,130,246,0.25);
          transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .auth-btn:hover:not(:disabled) { box-shadow: 0 6px 20px rgba(59,130,246,0.35); transform: translateY(-1px); }
        .auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .auth-error {
          margin-bottom: 16px; padding: 10px 16px;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
          border-radius: 10px; color: #f87171; font-size: 13px;
        }
        .spinner {
          width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.2);
          border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-badge">Oxford Academy Tools</div>
          <h1 className="auth-title">PDF → Markdown</h1>
          <p className="auth-subtitle">비밀번호를 입력하세요</p>
          {error && <div className="auth-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <input
              className="form-input"
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <button className="auth-btn" type="submit" disabled={loading || !password}>
              {loading ? <><div className="spinner" />확인 중...</> : '입장'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
