'use client';
import { useState } from 'react';
import { api } from '@/lib/types';

export type OrganizationToDelete = { kind: 'grade' | 'class'; id: string; name: string };

export default function DeleteOrganizationDialog({
  target,
  onCancel,
  onDeleted,
}: {
  target: OrganizationToDelete;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const label = target.kind === 'grade' ? '年级' : '班级';
  return (
    <div className="modal-overlay">
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-organization-title"
      >
        <h2 id="delete-organization-title">删除{label}</h2>
        <p>
          即将删除{label}：<b>{target.name}</b>
        </p>
        <p className="muted">
          {target.kind === 'grade'
            ? '只能删除没有班级和任务的年级。请先处理学生、删除班级，并在任务管理中处理该年级的任务。'
            : '只能删除没有学生的班级。请先将同学转入其他班级，或在学生管理中删除不再需要的学生账号。'}
        </p>
        <p className="error">删除不可恢复。此操作不会自动删除学生、任务或提交记录。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || confirmName !== target.name) return;
            setBusy(true);
            setError('');
            try {
              await api(`${target.kind === 'grade' ? 'grades' : 'classes'}/${target.id}/delete`, {
                confirmName,
              });
              onDeleted();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            输入完整{label}名称确认删除
            <input
              autoFocus
              required
              maxLength={60}
              autoComplete="off"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              disabled={busy}
              placeholder={target.name}
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
            <button className="danger-button" disabled={busy || confirmName !== target.name}>
              {busy ? '删除中…' : `确认删除${label}`}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
