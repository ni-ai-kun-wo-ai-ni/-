'use client';
import { useState } from 'react';
import { dateText, type Report } from '@/lib/types';
export default function ReportView({
  report,
  filterClass,
  selectClass,
}: {
  report: Report;
  filterClass: string;
  selectClass: (id: string) => void;
}) {
  const [tab, setTab] = useState('all');
  const [message, setMessage] = useState('');
  const scopedRows = report.rows.filter((r) => !filterClass || r.classId === filterClass);
  const missing = scopedRows.filter((r) => !r.submission);
  const submitted = scopedRows.filter((r) => r.submission).length;
  const pct = scopedRows.length ? Math.round((submitted / scopedRows.length) * 100) : 0;
  const classes = [...new Map(report.rows.map((r) => [r.classId, r.class])).values()].filter(
    (c) => c !== null,
  );
  const rows = report.rows.filter(
    (r) =>
      (!filterClass || r.classId === filterClass) &&
      (tab === 'all' || (tab === 'yes' ? !!r.submission : !r.submission)),
  );
  return (
    <>
      <div className="panel report-heading">
        <div>
          <div className="eyebrow">任务提交统计 · {report.task.displayStatus}</div>
          <h2>{report.task.title}</h2>
          <p className="muted">截止：{dateText(report.task.deadline)}</p>
        </div>
        <a
          className="button"
          href={`/api/tasks/${report.task.id}/export${filterClass ? `?classId=${filterClass}` : ''}`}
        >
          ↓ 导出 Excel
        </a>
      </div>
      <div className="stats">
        <div className="stat">
          <span>应提交人数</span>
          <strong>
            {scopedRows.length}
            <small>人</small>
          </strong>
        </div>
        <div className="stat">
          <span>已提交</span>
          <strong className="green">
            {submitted}
            <small>人</small>
          </strong>
        </div>
        <div className="stat">
          <span>未提交</span>
          <strong className="orange">
            {missing.length}
            <small>人</small>
          </strong>
        </div>
        <div className="stat">
          <span>完成率</span>
          <strong>
            {pct}
            <small>%</small>
          </strong>
          <progress value={pct} max={100} />
        </div>
      </div>
      <div className="two-column">
        <div className="panel">
          <h2>班级完成情况</h2>
          {classes.map((c) => {
            const students = report.rows.filter((r) => r.classId === c.id);
            const n = students.filter((r) => r.submission).length;
            return (
              <button
                className={`class-progress ${filterClass === c.id ? 'selected' : ''}`}
                key={c.id}
                onClick={() => selectClass(filterClass === c.id ? '' : c.id)}
              >
                <span>
                  {c.name}
                  <b>
                    {n}
                    <em> / {students.length}</em>
                  </b>
                </span>
                <progress value={n} max={students.length} />
              </button>
            );
          })}
        </div>
        <div className="panel">
          <div className="section-title">
            <h2>未提交提醒</h2>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    missing
                      .filter((r) => !filterClass || r.classId === filterClass)
                      .map((r) => `${r.name}（${r.studentNumber}）`)
                      .join('\n'),
                  );
                  setMessage('已复制名单');
                } catch {
                  setMessage('复制失败，请手动选择下方名单复制');
                }
              }}
            >
              复制名单
            </button>
          </div>
          <div className="name-tags">
            {missing
              .filter((r) => !filterClass || r.classId === filterClass)
              .map((r) => (
                <span key={r.id}>{r.name}</span>
              ))}
          </div>
          {!missing.length && <p className="muted">全部同学已完成提交。</p>}
          <p className="muted" role="status">
            {message}
          </p>
        </div>
      </div>
      <div className="panel">
        <div className="section-title">
          <h2>提交明细</h2>
          <span className="muted">
            {report.canView ? '可查看提交答案' : '本任务仅开放提交状态，答案不可见'}
          </span>
        </div>
        <div className="tabs">
          {[
            ['all', '全部学生'],
            ['yes', '已提交'],
            ['no', '未提交'],
          ].map(([id, title]) => (
            <button className={tab === id ? 'active' : ''} onClick={() => setTab(id)} key={id}>
              {title}
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>学号</th>
                <th>班级</th>
                <th>状态</th>
                {report.canView && report.task.fields?.map((f) => <th key={f.id}>{f.label}</th>)}
                <th>最近提交</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                  </td>
                  <td>{r.studentNumber}</td>
                  <td>{r.class?.name}</td>
                  <td>
                    <span className={`badge ${r.submission ? 'open' : 'pending'}`}>
                      {r.submission ? '已提交' : '未提交'}
                    </span>
                  </td>
                  {report.canView &&
                    report.task.fields?.map((f) => {
                      const answer = r.submission?.answers?.find((a) => a.fieldId === f.id);
                      const v = answer ? JSON.parse(answer.value) : '—';
                      return <td key={f.id}>{Array.isArray(v) ? v.join('、') : v || '—'}</td>;
                    })}
                  <td>{r.submission ? dateText(r.submission.updatedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
