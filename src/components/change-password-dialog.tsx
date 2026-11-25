'use client';
import { useRef, useState } from 'react';
import { api } from '@/lib/types';

export default function ChangePasswordDialog({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  return (
    <div className="modal-overlay">
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
      >
        <h2 id="change-password-title">修改个人密码</h2>
        <p className="muted">
          新密码至少8位，包含字母和数字。修改成功后，其他手机、电视及网页上的旧登录会立即失效，本设备继续登录。
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (inFlight.current) return;
            const form = new FormData(event.currentTarget);
            if (form.get('password') !== form.get('confirmPassword')) {
              setError('两次密码输入不一致');
              return;
            }
            inFlight.current = true;
            setBusy(true);
            setError('');
            try {
              await api('account/password', {
                oldPassword: form.get('oldPassword'),
                password: form.get('password'),
                confirmPassword: form.get('confirmPassword'),
              });
              await onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              inFlight.current = false;
              setBusy(false);
            }
          }}
        >
          <label>
            原密码
            <input
              name="oldPassword"
              type="password"
              required
              autoFocus
              maxLength={72}
              autoComplete="current-password"
              disabled={busy}
            />
          </label>
          <label>
            新密码
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              disabled={busy}
            />
          </label>
          <label>
            确认新密码
            <input
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              maxLength={72}
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
            <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
              取消
            </button>
            <button disabled={busy}>{busy ? '保存中…' : '修改密码'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
