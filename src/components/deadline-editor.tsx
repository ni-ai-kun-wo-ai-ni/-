'use client';
import { useState } from 'react';
import { api, type Task } from '@/lib/types';

// 与任务列表的北京时间一致，避免 ISO 的 UTC 时间直接截取后相差 8 小时。
function inputValue(deadline: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(deadline));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
type SavedDeadline = { deadline: string; displayStatus: string };
export default function DeadlineEditor({
  task,
  disabled,
  onSaved,
}: {
  task: Task;
  disabled: boolean;
  onSaved: (result: SavedDeadline) => void;
}) {
  const saved = inputValue(task.deadline);
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changed = value !== saved;
  return (
    <form
      className="deadline-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed || saving) return;
        setSaving(true);
        setError('');
        try {
          const result = await api<SavedDeadline>(`tasks/${task.id}/deadline`, {
            deadline: new Date(`${value}:00+08:00`).toISOString(),
          });
          onSaved(result);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="deadline-controls">
        <label className="deadline-edit">
          调整截止
          <input
            aria-label={`调整${task.title}截止时间（北京时间）`}
            title="北京时间，修改后点击保存"
            type="datetime-local"
            required
            value={value}
            disabled={disabled || saving}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
          />
        </label>
        {changed && (
          <>
            <button type="submit" disabled={disabled || saving || !value}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={saving}
              onClick={() => {
                setValue(saved);
                setError('');
              }}
            >
              取消
            </button>
          </>
        )}
      </div>
      {error && (
        <span className="deadline-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
