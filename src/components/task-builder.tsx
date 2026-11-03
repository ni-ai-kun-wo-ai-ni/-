'use client';
import { useState } from 'react';
import { api, type Bootstrap } from '@/lib/types';
const types: Record<string, string> = {
  TEXT: '单行文本',
  TEXTAREA: '多行文本',
  NUMBER: '数字',
  RADIO: '单选',
  CHECKBOX: '多选',
  DATE: '日期',
  BOOLEAN: '是 / 否',
};
type DraftField = { label: string; type: string; required: boolean; optionsText: string };
const blank = (): DraftField => ({ label: '', type: 'TEXT', required: true, optionsText: '' });
export default function TaskBuilder({ data, done }: { data: Bootstrap; done: () => void }) {
  const [fields, setFields] = useState<DraftField[]>([blank()]);
  const [gradeId, setGrade] = useState(data.grades[0]?.id || '');
  const [specific, setSpecific] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (index: number, value: Partial<DraftField>) =>
    setFields(fields.map((f, i) => (i === index ? { ...f, ...value } : f)));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const form = new FormData(e.currentTarget);
        try {
          await api('tasks', {
            title: form.get('title'),
            description: form.get('description'),
            gradeId,
            deadline: new Date(String(form.get('deadline'))).toISOString(),
            allowEdit: form.get('allowEdit') === 'on',
            officerCanView: form.get('officerCanView') === 'on',
            ...(specific ? { targetIds: targets } : {}),
            fields: fields.map((f) => ({
              label: f.label,
              type: f.type,
              required: f.required,
              options: ['RADIO', 'CHECKBOX'].includes(f.type)
                ? f.optionsText
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
            })),
          });
          done();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="panel">
        <div className="section-title">
          <span className="step">01</span>
          <h2>任务基本信息</h2>
        </div>
        <label>
          任务名称
          <input name="title" required maxLength={100} placeholder="例如：国庆假期去向统计" />
        </label>
        <label>
          任务说明
          <textarea
            name="description"
            maxLength={2000}
            rows={3}
            placeholder="向同学说明需要收集的信息与填写要求"
          />
        </label>
        <div className="form-grid">
          <label>
            目标年级
            <select
              value={gradeId}
              onChange={(e) => {
                setGrade(e.target.value);
                setTargets([]);
              }}
            >
              {data.grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            截止时间（电脑本地时区）
            <input type="datetime-local" name="deadline" required />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" name="allowEdit" defaultChecked />
          截止前允许学生修改
        </label>
        <label className="check">
          <input type="checkbox" name="officerCanView" />
          允许班干部查看本班答案（默认仅查看提交状态）
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={specific}
            onChange={(e) => setSpecific(e.target.checked)}
          />
          仅指定学生填写（不勾选则指定全年级）
        </label>
        {specific && (
          <div className="target-list">
            {data.students
              .filter((s) => s.class?.gradeId === gradeId)
              .map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={targets.includes(s.id)}
                    onChange={(e) =>
                      setTargets(
                        e.target.checked ? [...targets, s.id] : targets.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.name} · {s.class?.name}
                </label>
              ))}
          </div>
        )}
      </div>
      <div className="panel">
        <div className="section-title">
          <span className="step">02</span>
          <h2>设计收集表单</h2>
          <span className="muted">{fields.length} / 30 个字段</span>
        </div>
        <p className="muted">按实际需要添加字段，请勿收集身份证号、银行卡号等敏感信息。</p>
        {fields.map((f, i) => (
          <div className="field-card" key={i}>
            <div className="field-head">
              <b>字段 {String(i + 1).padStart(2, '0')}</b>
              <button
                type="button"
                className="text-button"
                disabled={fields.length === 1}
                onClick={() => setFields(fields.filter((_, j) => j !== i))}
              >
                删除
              </button>
            </div>
            <div className="form-grid">
              <label>
                字段名称
                <input
                  value={f.label}
                  required
                  maxLength={100}
                  placeholder="请输入字段名称"
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </label>
              <label>
                字段类型
                <select value={f.type} onChange={(e) => update(i, { type: e.target.value })}>
                  {Object.entries(types).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {['RADIO', 'CHECKBOX'].includes(f.type) && (
              <label>
                选项（每行一个，至少两个）
                <textarea
                  value={f.optionsText}
                  onChange={(e) => update(i, { optionsText: e.target.value })}
                  required
                  rows={3}
                />
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={f.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />
              必填项
            </label>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={fields.length >= 30}
          onClick={() => setFields([...fields, blank()])}
        >
          ＋ 添加字段
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-footer">
        <span className="muted">保存为草稿后，可在任务管理中发布。</span>
        <button disabled={busy}>{busy ? '保存中…' : '保存草稿 →'}</button>
      </div>
    </form>
  );
}
