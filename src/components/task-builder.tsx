'use client';
import { useRef, useState } from 'react';
import { api, type Bootstrap } from '@/lib/types';
import { beijingInputToIso, defaultDeadline } from '@/lib/beijing-time';
import TaskTargetPicker from './task-target-picker';
const types: Record<string, string> = {
  TEXT: '单行文本',
  TEXTAREA: '多行文本',
  NUMBER: '数字',
  RADIO: '单选',
  CHECKBOX: '多选',
  DATE: '日期',
  BOOLEAN: '是 / 否',
  FILE: '文件上传',
  PHOTO: '照片上传',
  SIGNATURE: '手写签名',
};
type DraftField = { label: string; type: string; required: boolean; optionsText: string };
const blank = (): DraftField => ({ label: '', type: 'TEXT', required: true, optionsText: '' });
export default function TaskBuilder({
  data,
  done,
  initialGradeId,
}: {
  data: Bootstrap;
  done: () => void;
  initialGradeId?: string;
}) {
  const [fields, setFields] = useState<DraftField[]>([blank()]);
  const [gradeId, setGrade] = useState(initialGradeId || data.grades[0]?.id || '');
  const [specific, setSpecific] = useState(false);
  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [deadline, setDeadline] = useState(defaultDeadline);
  const update = (index: number, value: Partial<DraftField>) =>
    setFields(fields.map((f, i) => (i === index ? { ...f, ...value } : f)));
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError('');
        const form = new FormData(e.currentTarget);
        try {
          if (specific && !targets.length) throw new Error('请至少选择一名填写学生');
          await api('tasks', {
            title: form.get('title'),
            description: form.get('description'),
            gradeId,
            managerIds,
            deadline: beijingInputToIso(deadline),
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
          inFlight.current = false;
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
            截止时间（北京时间）
            <input
              type="datetime-local"
              name="deadline"
              required
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </label>
        </div>
        <fieldset className="panel">
          <legend>共同管理人（选填）</legend>
          <p className="muted">
            选择一起负责的学生干部。共同管理人可查看草稿、全部结果和附件，导出、发布、结束、调整截止时间及删除此任务。未选中的学生干部没有此任务的管理权限。
          </p>
          {!(data.managerCandidates || []).length && (
            <p className="muted">暂无其他学生干部，请先由老师设置身份。</p>
          )}
          {(data.managerCandidates || []).map((person) => (
            <label key={person.id} className="check">
              <input
                type="checkbox"
                checked={managerIds.includes(person.id)}
                onChange={(e) =>
                  setManagerIds(
                    e.target.checked
                      ? [...managerIds, person.id]
                      : managerIds.filter((id) => id !== person.id),
                  )
                }
              />
              {person.name} · {person.studentNumber || '无学号'} ·{' '}
              {person.class?.name || '暂未分班'}
            </label>
          ))}
        </fieldset>
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
          <TaskTargetPicker
            students={(data.user.role === 'TEACHER'
              ? data.students
              : data.publisherStudents || []
            ).filter((s) => (s.class?.gradeId || s.gradeId) === gradeId)}
            gradeName={data.grades.find((g) => g.id === gradeId)?.name || ''}
            targets={targets}
            setTargets={setTargets}
          />
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
            {['FILE', 'PHOTO'].includes(f.type) && (
              <p className="muted">
                每题最多5个文件，单个不超过50 MB，整份提交附件合计不超过80 MB。
                {f.type === 'PHOTO'
                  ? '照片支持JPG、PNG、GIF、WebP。'
                  : '支持常用文档、图片和ZIP压缩包。'}
                提交后可在任务统计中查看和下载。
              </p>
            )}
            {f.type === 'SIGNATURE' && (
              <p className="muted">
                学生可用鼠标或手指手写签名，支持清空重写。签名以图片保存，可在任务统计中查看和下载；每题保留一份签名。
              </p>
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
