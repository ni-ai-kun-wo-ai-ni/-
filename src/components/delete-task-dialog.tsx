'use client';
import { useState } from 'react';
import { api, type Task } from '@/lib/types';

export default function DeleteTaskDialog({
  task,
  onCancel,
  onDeleted,
}: {
  task: Task;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [confirmTitle, setConfirmTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="modal-overlay">
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-task-title"
      >
        <h2 id="delete-task-title">删除任务</h2>
        <p>
          即将删除任务：<b>{task.title}</b>
        </p>
        <p className="error">
          此操作不可恢复。该任务的表单字段、填写名单、全部学生提交及答案会一并删除；删除后不能再查看统计或导出结果。如需保留数据，请先导出
          Excel。
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || confirmTitle !== task.title) return;
            setBusy(true);
            setError('');
            try {
              await api(`tasks/${task.id}/delete`, { confirmTitle });
              onDeleted();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            输入完整任务名称确认删除
            <input
              autoFocus
              aria-label="确认删除的任务名称"
              value={confirmTitle}
              onChange={(e) => setConfirmTitle(e.target.value)}
              required
              maxLength={100}
              autoComplete="off"
              disabled={busy}
              placeholder={task.title}
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
            <button className="danger-button" disabled={busy || confirmTitle !== task.title}>
              {busy ? '删除中…' : '确认删除任务'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
