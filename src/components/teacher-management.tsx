'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/types';

type Teacher = {
  id: string;
  username: string;
  name: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
};
export default function TeacherManagement({
  userId,
  onSelfUpdated,
  onRelogin,
}: {
  userId: string;
  onSelfUpdated: () => Promise<void>;
  onRelogin: () => void;
}) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [created, setCreated] = useState<{ teacher: Teacher; initialPassword: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<Teacher | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [editing, setEditing] = useState<Teacher | null>(null);
  async function refresh() {
    setTeachers(await api<Teacher[]>('teachers'));
  }
  useEffect(() => {
    api<Teacher[]>('teachers')
      .then(setTeachers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <h2>教师账号管理</h2>
          <span className="badge">仅超级管理员</span>
        </div>
        <p className="muted">
          新建账号拥有教师权限，可管理全年级任务、学生和班级。只有超级管理员可以管理教师账号。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const form = e.currentTarget;
            const values = new FormData(form);
            setBusy(true);
            setError('');
            setNotice('');
            try {
              const result = await api<{ teacher: Teacher; initialPassword: string }>('teachers', {
                name: values.get('name'),
                username: values.get('username'),
              });
              setCreated(result);
              form.reset();
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            教师姓名
            <input
              name="name"
              required
              maxLength={60}
              disabled={busy}
              placeholder="请输入教师姓名"
            />
          </label>
          <label>
            登录账号
            <input
              name="username"
              required
              pattern="[A-Za-z0-9_\-]{3,60}"
              minLength={3}
              maxLength={60}
              disabled={busy}
              placeholder="3—60位字母、数字、下划线或短横线"
              autoComplete="off"
            />
          </label>
          <p className="muted">初始密码统一为 123456。请私下告知本人，首次登录必须设置个人密码。</p>
          <button disabled={busy || loading}>{busy ? '处理中…' : '创建教师账号'}</button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
      </section>
      <section className="panel">
        <h2>教师列表（{teachers.length}）</h2>
        {loading ? (
          <p>正在加载…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>登录账号</th>
                  <th>权限</th>
                  <th>密码状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((teacher) => (
                  <tr key={teacher.id}>
                    <td>{teacher.name}</td>
                    <td>{teacher.username}</td>
                    <td>{teacher.isSuperAdmin ? '超级管理员' : '教师'}</td>
                    <td>{teacher.mustChangePassword ? '待首次改密' : '已设置'}</td>
                    <td>
                      {(!teacher.isSuperAdmin || teacher.id === userId) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(teacher);
                            setError('');
                            setNotice('');
                          }}
                        >
                          修改信息
                        </button>
                      )}
                      {teacher.isSuperAdmin || teacher.id === userId ? (
                        <span className="muted">受保护</span>
                      ) : (
                        <button
                          className="text-button danger"
                          disabled={busy}
                          onClick={() => {
                            setDeleting(teacher);
                            setConfirmation('');
                            setError('');
                          }}
                        >
                          删除账号
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && (
        <div className="modal-overlay">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-edit-title"
          >
            <h2 id="teacher-edit-title">修改教师信息</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                const values = new FormData(e.currentTarget);
                const password = String(values.get('password') || '');
                if (password !== String(values.get('confirmPassword') || '')) {
                  setError('两次密码输入不一致');
                  return;
                }
                setBusy(true);
                setError('');
                setNotice('');
                try {
                  const result = await api<{ teacher: Teacher; reauthenticate: boolean }>(
                    `teachers/${editing.id}/update`,
                    {
                      name: values.get('name'),
                      username: values.get('username'),
                      ...(password ? { password } : {}),
                    },
                  );
                  setEditing(null);
                  if (result.reauthenticate) {
                    onRelogin();
                    return;
                  }
                  setNotice('教师信息已保存');
                  await refresh();
                  if (result.teacher.id === userId) await onSelfUpdated();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                姓名
                <input
                  name="name"
                  defaultValue={editing.name}
                  autoFocus
                  required
                  maxLength={60}
                  disabled={busy}
                />
              </label>
              <label>
                登录账号
                <input
                  name="username"
                  defaultValue={editing.username}
                  pattern="[A-Za-z0-9_\-]{3,60}"
                  required
                  minLength={3}
                  maxLength={60}
                  disabled={busy}
                  autoComplete="off"
                />
              </label>
              <label>
                新密码（留空则保持原密码）
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  maxLength={72}
                  disabled={busy}
                  autoComplete="new-password"
                />
              </label>
              <label>
                确认新密码
                <input
                  name="confirmPassword"
                  type="password"
                  maxLength={72}
                  disabled={busy}
                  autoComplete="new-password"
                />
              </label>
              <p className="muted">
                新密码至少8位。修改登录账号或密码后，该账号需要重新登录。
                {editing.isSuperAdmin
                  ? '超级管理员权限和删除保护保留。'
                  : '重设密码后，该教师首次登录需设置个人密码。'}
              </p>
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
                  onClick={() => {
                    setEditing(null);
                    setError('');
                  }}
                >
                  取消
                </button>
                <button disabled={busy}>{busy ? '保存中…' : '保存修改'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {created && (
        <div className="modal-overlay">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-created-title"
          >
            <h2 id="teacher-created-title">教师账号已创建</h2>
            <p>姓名：{created.teacher.name}</p>
            <p>
              登录账号：<b>{created.teacher.username}</b>
            </p>
            <p>
              初始密码：<code>{created.initialPassword}</code>
            </p>
            <p className="notice">请私下告知该教师账号和初始密码。首次登录后需要设置个人密码。</p>
            <div className="modal-actions">
              <button autoFocus onClick={() => setCreated(null)}>
                我已保存，关闭
              </button>
            </div>
          </section>
        </div>
      )}
      {deleting && (
        <div className="modal-overlay">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="teacher-delete-title"
          >
            <h2 id="teacher-delete-title">删除教师账号</h2>
            <p>
              即将删除 {deleting.name}（{deleting.username}
              ）。删除不可恢复，该教师将立即无法登录；其创建的任务移交给你，学生和填写结果保留。
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy || confirmation !== deleting.username) return;
                setBusy(true);
                setError('');
                setNotice('');
                try {
                  await api(`teachers/${deleting.id}/delete`, { confirmUsername: confirmation });
                  setDeleting(null);
                  setNotice('教师账号已删除，其任务已移交给你');
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                输入登录账号确认删除
                <input
                  autoFocus
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  disabled={busy}
                  autoComplete="off"
                  required
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
                  onClick={() => {
                    setDeleting(null);
                    setError('');
                  }}
                >
                  取消
                </button>
                <button className="danger" disabled={busy || confirmation !== deleting.username}>
                  {busy ? '删除中…' : '确认删除'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
