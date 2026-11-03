'use client';
import { useState } from 'react';
import { api, type Person } from '@/lib/types';

export default function InitialPasswordDialog({
  user,
  onSaved,
  onLogout,
}: {
  user: Person;
  onSaved: () => Promise<void>;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="loading">
      <div className="modal-overlay">
        <section
          className="modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="initial-password-title"
        >
          <h2 id="initial-password-title">首次登录，请设置自己的密码</h2>
          <p>
            {user.name}，你的登录账号为 <b>{user.username}</b>。
          </p>
          <p className="muted">设置完成后使用新密码登录。密码至少8位，包含字母和数字。</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              setError('');
              if (form.get('password') !== form.get('confirmPassword')) {
                setError('两次密码输入不一致');
                return;
              }
              setBusy(true);
              try {
                await api('account/initial-password', {
                  password: form.get('password'),
                  confirmPassword: form.get('confirmPassword'),
                });
                await onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              新密码
              <input
                autoFocus
                name="password"
                type="password"
                minLength={8}
                maxLength={72}
                required
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            <label>
              再次输入新密码
              <input
                name="confirmPassword"
                type="password"
                minLength={8}
                maxLength={72}
                required
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api('logout', {});
                    onLogout();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                退出登录
              </button>
              <button disabled={busy}>{busy ? '保存中…' : '保存新密码并进入'}</button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
