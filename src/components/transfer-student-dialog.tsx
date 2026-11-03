'use client';
import { useState } from 'react';
import { api, type Bootstrap, type Person } from '@/lib/types';

export default function TransferStudentDialog({
  student,
  grades,
  onCancel,
  onTransferred,
}: {
  student: Person;
  grades: Bootstrap['grades'];
  onCancel: () => void;
  onTransferred: (student: Person) => Promise<void>;
}) {
  const [gradeId, setGradeId] = useState(student.class?.gradeId || grades[0]?.id || '');
  const [classId, setClassId] = useState('');
  const [officer, setOfficer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const grade = grades.find((g) => g.id === gradeId);
  return (
    <div className="modal-overlay">
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-student-title"
      >
        <h2 id="transfer-student-title">学生转班</h2>
        <p>
          <b>{student.name}</b>（{student.studentNumber}）<br />
          当前班级：{student.class?.name || '未分班'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              const updated = await api<Person>(`students/${student.id}/transfer`, {
                classId,
                fromClassId: student.classId,
                isClassOfficer: officer,
              });
              await onTransferred(updated);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset className="student-fields" disabled={busy}>
            <div className="form-grid">
              <label>
                目标年级
                <select
                  value={gradeId}
                  onChange={(e) => {
                    setGradeId(e.target.value);
                    setClassId('');
                  }}
                >
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                目标班级
                <select
                  autoFocus
                  required
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                >
                  <option value="" disabled>
                    请选择转入班级
                  </option>
                  {grade?.classes.map((c) => (
                    <option key={c.id} value={c.id} disabled={c.id === student.classId}>
                      {c.name}
                      {c.id === student.classId ? '（当前班级）' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={officer}
                onChange={(e) => setOfficer(e.target.checked)}
              />
              转入后设为班干部
            </label>
          </fieldset>
          <p className="muted">
            默认以普通学生身份转入。勾选班干部后，该学生将获得目标班级管理权限。
          </p>
          <p className="notice">
            账号、密码和已有提交保留，历史任务统计按转班后的班级归属。不会自动加入目标年级以前创建的任务。
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
              取消
            </button>
            <button disabled={busy || !classId || classId === student.classId}>
              {busy ? '转班中…' : '确认转班'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
