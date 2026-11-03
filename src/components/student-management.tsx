'use client';
import { useState, useRef } from 'react';
import { api, type Bootstrap, type Person } from '@/lib/types';
import TransferStudentDialog from './transfer-student-dialog';
import StudentIdentityDialog from './student-identity-dialog';

export default function StudentManagement({
  data,
  gradeFilter,
  search,
  setSearch,
  refresh,
}: {
  data: Bootstrap;
  gradeFilter: string;
  search: string;
  setSearch: (value: string) => void;
  refresh: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Person | null>(null);
  const [transferring, setTransferring] = useState<Person | null>(null);
  const [settingIdentity, setSettingIdentity] = useState<Person | null>(null);
  const [confirmUsername, setConfirmUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [chosenGrade, setChosenGrade] = useState('');
  const [newStudentNumber, setNewStudentNumber] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const students = data.students.filter((s) => !gradeFilter || s.class?.gradeId === gradeFilter);
  const visible = students.filter((s) =>
    `${s.name}${s.studentNumber}${s.class?.name}${s.username}`.includes(search),
  );
  const grade = data.grades.find((g) => g.id === chosenGrade);
  const openAdd = () => {
    setError('');
    setNotice('');
    setChosenGrade(gradeFilter || data.grades[0]?.id || '');
    setDeleting(null);
    setTransferring(null);
    setSettingIdentity(null);
    setAdding(true);
    setNewStudentNumber('');
  };

  return (
    <>
      <div className="panel">
        <div className="section-title student-toolbar">
          <h2>
            学生名册 <small className="muted">{students.length} 人</small>
          </h2>
          <input
            className="search"
            aria-label="搜索学生"
            placeholder="搜索姓名、学号、班级或账号…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button disabled={busy || !data.grades.some((g) => g.classes.length)} onClick={openAdd}>
            ＋ 添加学生
          </button>
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>学号</th>
                <th>班级</th>
                <th>身份</th>
                <th>登录账号</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                  </td>
                  <td>{s.studentNumber}</td>
                  <td>{s.class?.name}</td>
                  <td>
                    <span className={`badge ${s.isClassOfficer ? 'open' : 'draft'}`}>
                      {s.isClassOfficer ? '班干部' : '学生'}
                    </span>
                  </td>
                  <td>
                    {s.username}
                    {s.mustChangePassword && <span className="badge pending">待首次改密</span>}
                  </td>
                  <td>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setSettingIdentity(s);
                        setTransferring(null);
                        setAdding(false);
                        setDeleting(null);
                        setError('');
                        setNotice('');
                      }}
                    >
                      设置身份
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setTransferring(s);
                        setSettingIdentity(null);
                        setAdding(false);
                        setDeleting(null);
                        setError('');
                        setNotice('');
                      }}
                    >
                      转班
                    </button>
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => {
                        setDeleting(s);
                        setConfirmUsername('');
                        setError('');
                        setNotice('');
                        setAdding(false);
                        setTransferring(null);
                        setSettingIdentity(null);
                      }}
                    >
                      删除账号
                    </button>
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={6}>没有符合条件的学生。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {settingIdentity && (
        <StudentIdentityDialog
          key={settingIdentity.id}
          student={settingIdentity}
          onCancel={() => setSettingIdentity(null)}
          onSaved={async (updated) => {
            setSettingIdentity(null);
            setNotice(`${updated.name} 已设为${updated.isClassOfficer ? '班干部' : '普通学生'}。`);
            try {
              await refresh();
            } catch {
              setNotice('身份已更新，但刷新列表失败，请刷新页面查看。');
            }
          }}
        />
      )}
      {transferring && (
        <TransferStudentDialog
          key={transferring.id}
          student={transferring}
          grades={data.grades}
          onCancel={() => setTransferring(null)}
          onTransferred={async (updated) => {
            setTransferring(null);
            setSearch('');
            setNotice(
              `${updated.name} 已转入${updated.class?.name}，身份为${updated.isClassOfficer ? '班干部' : '普通学生'}。`,
            );
            try {
              await refresh();
            } catch {
              setNotice('转班已完成，但刷新列表失败，请刷新页面查看。');
            }
          }}
        />
      )}
      {adding && (
        <div className="modal-overlay">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-student-title"
          >
            <h2 id="add-student-title">添加学生账号</h2>
            <p className="muted">
              学号即登录账号，初始密码为
              123456。学生首次登录必须设置自己的密码。新学生不会自动加入以前创建的任务。
            </p>
            <form
              ref={formRef}
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                setBusy(true);
                setError('');
                try {
                  const student = await api<Person>('students', {
                    name: form.get('name'),
                    studentNumber: form.get('studentNumber'),
                    classId: form.get('classId'),
                    isClassOfficer: form.get('isClassOfficer') === 'on',
                  });
                  formRef.current?.reset();
                  setAdding(false);
                  setSearch('');
                  setNotice(
                    `${student.name} 的账号 ${student.username} 已创建，初始密码为 123456，首次登录需改密。`,
                  );
                  try {
                    await refresh();
                  } catch {
                    setNotice('账号已创建，但刷新列表失败，请刷新页面查看，勿重复添加。');
                  }
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy} className="student-fields">
                <div className="form-grid">
                  <label>
                    姓名
                    <input name="name" autoFocus required maxLength={60} autoComplete="off" />
                  </label>
                  <label>
                    学号
                    <input
                      name="studentNumber"
                      required
                      maxLength={32}
                      pattern="[A-Za-z0-9_-]+"
                      autoComplete="off"
                      value={newStudentNumber}
                      onChange={(e) => setNewStudentNumber(e.target.value)}
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    年级
                    <select value={chosenGrade} onChange={(e) => setChosenGrade(e.target.value)}>
                      {data.grades.map((g) => (
                        <option value={g.id} key={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    班级
                    <select key={chosenGrade} name="classId" required defaultValue="">
                      <option value="" disabled>
                        请选择班级
                      </option>
                      {grade?.classes.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  登录账号
                  <input
                    readOnly
                    value={newStudentNumber.trim()}
                    autoComplete="off"
                    placeholder="自动使用学号"
                  />
                </label>
                <label>
                  初始密码
                  <input value="123456" readOnly />
                </label>
                <label className="check">
                  <input name="isClassOfficer" type="checkbox" />
                  设为班干部（拥有本班管理权限）
                </label>
              </fieldset>
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
                  onClick={() => setAdding(false)}
                >
                  取消
                </button>
                <button disabled={busy}>{busy ? '创建中…' : '创建账号'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {deleting && (
        <div className="modal-overlay">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-student-title"
          >
            <h2 id="delete-student-title">删除学生账号</h2>
            <p>
              即将删除 <b>{deleting.name}</b>（学号：{deleting.studentNumber}，
              {deleting.class?.name}）。
            </p>
            <p className="error">
              此操作不可恢复：会同时删除该学生的提交答案和任务关联，影响相关任务统计，并立即使其登录失效。不会删除其他学生或任务本身。
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                try {
                  await api(`students/${deleting.id}/delete`, { confirmUsername });
                  setDeleting(null);
                  setNotice('学生账号及关联数据已删除。');
                  try {
                    await refresh();
                  } catch {
                    setNotice('删除已完成，但刷新列表失败，请刷新页面查看。');
                  }
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                输入登录账号 <b>{deleting.username}</b> 确认删除
                <input
                  autoFocus
                  value={confirmUsername}
                  onChange={(e) => setConfirmUsername(e.target.value)}
                  required
                  autoComplete="off"
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
                  onClick={() => setDeleting(null)}
                >
                  取消
                </button>
                <button
                  className="danger-button"
                  disabled={busy || confirmUsername !== deleting.username}
                >
                  {busy ? '删除中…' : '确认删除账号'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
