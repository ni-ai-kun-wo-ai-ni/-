'use client';
import { useState } from 'react';
import { api, dateText, type Submission, type Task } from '@/lib/types';
export default function StudentForm({
  task,
  submission,
  done,
}: {
  task: Task;
  submission: Submission | null;
  done: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(submission?.answers?.map((a) => [a.fieldId, JSON.parse(a.value)]) || []),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = task.displayStatus !== '收集中' || (!!submission && !task.allowEdit);
  return (
    <form
      className="panel form-sheet"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await api(`tasks/${task.id}/submit`, answers);
          done();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="eyebrow">信息收集 / {task.displayStatus}</div>
      <h2>{task.title}</h2>
      <p className="description">{task.description}</p>
      <p className="muted">
        截止：{dateText(task.deadline)} · {task.allowEdit ? '截止前可修改' : '提交后不可修改'}
      </p>
      {submission && <p className="notice">最近提交：{dateText(submission.updatedAt)}</p>}
      <fieldset disabled={locked || busy}>
        {task.fields?.map((f, i) => {
          const value = answers[f.id] ?? '';
          const change = (v: string | string[]) => setAnswers({ ...answers, [f.id]: v });
          const options: string[] = f.type === 'BOOLEAN' ? ['是', '否'] : JSON.parse(f.options);
          return (
            <div className="question" key={f.id}>
              <label htmlFor={f.id}>
                <span className="question-number">{i + 1}.</span> {f.label}
                {f.required && <span className="required"> *</span>}
              </label>
              {['TEXT', 'NUMBER', 'DATE'].includes(f.type) ? (
                <input
                  id={f.id}
                  type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'}
                  step="any"
                  required={f.required}
                  maxLength={500}
                  value={value as string}
                  onChange={(e) => change(e.target.value)}
                />
              ) : f.type === 'TEXTAREA' ? (
                <textarea
                  id={f.id}
                  required={f.required}
                  maxLength={5000}
                  rows={4}
                  value={value as string}
                  onChange={(e) => change(e.target.value)}
                />
              ) : (
                <div className="choices" role="group" aria-label={f.label}>
                  {options.map((o) => (
                    <label key={o} className="choice">
                      <input
                        type={f.type === 'CHECKBOX' ? 'checkbox' : 'radio'}
                        name={f.id}
                        value={o}
                        checked={
                          f.type === 'CHECKBOX'
                            ? Array.isArray(value) && value.includes(o)
                            : value === o
                        }
                        required={f.type !== 'CHECKBOX' && f.required}
                        onChange={(e) =>
                          change(
                            f.type === 'CHECKBOX'
                              ? e.target.checked
                                ? [...(Array.isArray(value) ? value : []), o]
                                : (Array.isArray(value) ? value : []).filter((v) => v !== o)
                              : o,
                          )
                        }
                      />
                      {o}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {locked ? (
        <p className="notice">
          {task.displayStatus !== '收集中' ? '此任务当前不能填写。' : '已提交，此任务不允许修改。'}
        </p>
      ) : (
        <button disabled={busy}>{busy ? '提交中…' : submission ? '保存修改' : '确认提交 →'}</button>
      )}
    </form>
  );
}
