'use client';
import { useState } from 'react';
import { api, type Bootstrap } from '@/lib/types';

export default function OrganizationManagement({
  data,
  gradeFilter,
  selectGrade,
  refresh,
  viewStudents,
}: {
  data: Bootstrap;
  gradeFilter: string;
  selectGrade: (id: string) => void;
  refresh: () => Promise<void>;
  viewStudents: (gradeId: string, className: string) => void;
}) {
  const [mode, setMode] = useState<'grade' | 'class' | null>(null);
  const [selectedGrade, setSelectedGrade] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const grades = data.grades.filter((g) => !gradeFilter || g.id === gradeFilter);
  function openClass(gradeId = gradeFilter || data.grades[0]?.id || '') {
    setMode('class');
    setSelectedGrade(gradeId);
    setError('');
    setNotice('');
  }
  return (
    <>
      <div className="panel">
        <div className="section-title student-toolbar">
          <h2>年级与班级管理</h2>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setMode('grade');
              setError('');
              setNotice('');
            }}
          >
            ＋ 添加年级
          </button>
          <button disabled={busy || !data.grades.length} onClick={() => openClass()}>
            ＋ 添加班级
          </button>
        </div>
        {!data.grades.length && <p className="muted">先添加年级，再为该年级添加班级。</p>}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
      </div>
      {grades.map((g) => (
        <section key={g.id}>
          <div className="section-title">
            <h2>{g.name}</h2>
            <span className="muted">{g.classes.length} 个班级</span>
            <button className="text-button" onClick={() => openClass(g.id)}>
              ＋ 添加班级
            </button>
          </div>
          {!g.classes.length ? (
            <div className="panel empty">这个年级还没有班级，点击“添加班级”开始创建。</div>
          ) : (
            <div className="class-grid">
              {g.classes.map((c) => (
                <div key={c.id} className="panel class-card">
                  <h2>{c.name}</h2>
                  <strong>
                    {c._count.students}
                    <small> 位同学</small>
                  </strong>
                  <p className="muted">
                    班干部：
                    {data.students
                      .filter((s) => s.classId === c.id && s.isClassOfficer)
                      .map((s) => s.name)
                      .join('、') || '暂无'}
                  </p>
                  <button className="secondary" onClick={() => viewStudents(g.id, c.name)}>
                    查看学生名册 →
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
      {mode && (
        <div className="modal-overlay">
          <section
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="organization-title"
          >
            <h2 id="organization-title">{mode === 'grade' ? '添加年级' : '添加班级'}</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                const form = new FormData(e.currentTarget);
                setBusy(true);
                setError('');
                try {
                  if (mode === 'grade') {
                    const result = await api<{ id: string; name: string }>('grades', {
                      name: form.get('name'),
                    });
                    selectGrade(result.id);
                    setNotice(`${result.name} 已创建，可以继续添加班级。`);
                  } else {
                    const result = await api<{ id: string; name: string; gradeId: string }>(
                      'classes',
                      { name: form.get('name'), gradeId: selectedGrade },
                    );
                    selectGrade(result.gradeId);
                    setNotice(`${result.name} 已创建，可在添加学生、转班和创建任务时选择。`);
                  }
                  setMode(null);
                  try {
                    await refresh();
                  } catch {
                    setNotice('创建已成功，但刷新列表失败，请刷新页面查看，勿重复创建。');
                  }
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {mode === 'class' && (
                <label>
                  所属年级
                  <select
                    value={selectedGrade}
                    required
                    disabled={busy}
                    onChange={(e) => setSelectedGrade(e.target.value)}
                  >
                    <option value="" disabled>
                      请选择年级
                    </option>
                    {data.grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {mode === 'grade' ? '年级名称' : '班级名称'}
                <input
                  autoFocus
                  name="name"
                  required
                  maxLength={60}
                  disabled={busy}
                  autoComplete="off"
                  placeholder={mode === 'grade' ? '例如：2026级' : '例如：印刷工程1班'}
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
                  onClick={() => setMode(null)}
                >
                  取消
                </button>
                <button disabled={busy || (mode === 'class' && !selectedGrade)}>
                  {busy ? '创建中…' : '确认添加'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
