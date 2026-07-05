import { useState } from 'react';
import { supabase } from './supabaseClient';

export default function Auth() {
  const [mode, setMode] = useState('login'); // 'login' または 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('確認メールを送信しました。メール内のリンクをクリックしてください。');
      }
    } catch (err) {
      setErrorMessage(err.message || 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <h2>{mode === 'login' ? 'ログイン' : '新規登録'}</h2>

      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email">メールアドレス</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '新規登録'}
        </button>
      </form>

      {message && <p className="auth-message">{message}</p>}
      {errorMessage && <p className="auth-error">{errorMessage}</p>}

      <button
        type="button"
        className="auth-toggle"
        onClick={() => {
          setMode(mode === 'login' ? 'signup' : 'login');
          setMessage(null);
          setErrorMessage(null);
        }}
      >
        {mode === 'login' ? 'アカウントを作成する' : 'ログイン画面に戻る'}
      </button>
    </div>
  );
}
