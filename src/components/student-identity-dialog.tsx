'use client';
import { useState } from 'react';
import { api, type Person } from '@/lib/types';

export default function StudentIdentityDialog({
  student,
  onCancel,
  onSaved,
}: {
  student: Person;
  onCancel: () => void;
  onSaved: (student: Person) => Promise<void>;
}) {
  const [officer, setOfficer] = useState(student.isClassOfficer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="modal-overlay">
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-identity-title"
      >
        <h2 id="student-identity-title">设置学生身份</h2>
        <p>
          <b>{student.name}</b>（{student.studentNumber}）<br />
          所属班级：{student.class?.name || '未分班'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || officer === student.isClassOfficer) return;
            setBusy(true);
            setError('');
            try {
              const updated = await api<Person>(`students/${student.id}/identity`, {
                isClassOfficer: officer,
                fromClassId: student.classId,
              });
              await onSaved(updated);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            学生身份
            <select
              autoFocus
              aria-label="学生身份"
              value={String(officer)}
              onChange={(e) => setOfficer(e.target.value === 'true')}
              disabled={busy}
            >
              <option value="false">普通学生</option>
              <option value="true" disabled={!student.classId}>
                班干部
              </option>
            </select>
          </label>
          <p className="notice">
            {officer
              ? '设为班干部后，可以管理本班任务统计、查看允许公开的本班答案，并导出本班数据。'
              : '改为普通学生后，将立即取消班级统计、查看他人答案及班级导出权限，仍可填写和查看自己的任务。'}
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
            <button disabled={busy || officer === student.isClassOfficer}>
              {busy ? '保存中…' : '保存身份'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
