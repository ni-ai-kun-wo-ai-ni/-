'use client';
import { useState } from 'react';
import type { Bootstrap } from '@/lib/types';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type StudentImportPreview,
} from '@/lib/student-import-types';

export default function StudentImportDialog({
  grades,
  initialGradeId,
  onCancel,
  onImported,
}: {
  grades: Bootstrap['grades'];
  initialGradeId: string;
  onCancel: () => void;
  onImported: (count: number) => void;
}) {
  const [gradeId, setGradeId] = useState(initialGradeId || grades[0]?.id || '');
  const [classId, setClassId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<StudentImportPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState('');
  const grade = grades.find((g) => g.id === gradeId);
  async function upload(mode: 'preview' | 'commit') {
    if (!file || !classId || busy) return;
    setError('');
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > MAX_IMPORT_BYTES) {
      setError('请选择不超过 1 MB 的 .xlsx 文件');
      return;
    }
    setBusy(mode);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('classId', classId);
      form.set('mode', mode);
      const response = await fetch('/api/students/import', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '导入失败，请稍后重试');
      if (mode === 'preview') setPreview(result);
      else onImported(result.imported);
    } catch (error) {
      setError((error as Error).message);
      if (mode === 'commit') setPreview(null);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="modal-overlay">
      <section
        className="modal-card import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-import-title"
      >
        <h2 id="student-import-title">批量导入学生</h2>
        <p className="muted">
          每次导入一个班，最多 {MAX_IMPORT_ROWS}{' '}
          人。表格第一行需有“姓名”和“学号”两列，读取第一个工作表。其他列不导入。学号请设置为文本，保留前导零。
        </p>
        <a className="button secondary" href="/api/students/import-template" download>
          下载 Excel 模板
        </a>
        <p className="muted">
          账号为学号，初始密码 123456，首次登录必须改密。全部按普通学生创建，不自动加入历史任务。
        </p>
        <fieldset className="student-fields" disabled={!!busy}>
          <div className="form-grid">
            <label>
              年级
              <select
                value={gradeId}
                onChange={(e) => {
                  setGradeId(e.target.value);
                  setClassId('');
                  setPreview(null);
                  setError('');
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
              导入到班级
              <select
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setPreview(null);
                  setError('');
                }}
              >
                <option value="" disabled>
                  请选择班级
                </option>
                {grade?.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            上传表格（.xlsx，不超过 1 MB）
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
                setError('');
              }}
            />
          </label>
          <button
            className="secondary"
            disabled={!file || !classId || !!busy}
            onClick={() => void upload('preview')}
          >
            {busy === 'preview' ? '检查中…' : '检查并预览'}
          </button>
        </fieldset>
        {preview && (
          <>
            <p role="status">
              将导入到{' '}
              <b>
                {preview.gradeName} · {preview.className}
              </b>
              ，共 {preview.rows.length} 人。
              {preview.canImport
                ? '检查通过，请核对后确认导入。'
                : '存在错误，本次不会导入，请修改表格后重新上传。'}
            </p>
            <div className="table-wrap import-preview">
              <table>
                <thead>
                  <tr>
                    <th>表格行号</th>
                    <th>姓名</th>
                    <th>学号 / 账号</th>
                    <th>检查结果</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>{row.name}</td>
                      <td>{row.studentNumber}</td>
                      <td className={row.errors.length ? 'error' : ''}>
                        {row.errors.join('；') || '可导入'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {busy === 'commit' && (
          <p role="status">正在创建账号，请保持页面打开。人数较多时需要等待约一分钟。</p>
        )}
        <div className="modal-actions">
          <button className="secondary" disabled={!!busy} onClick={onCancel}>
            取消
          </button>
          <button disabled={!!busy || !preview?.canImport} onClick={() => void upload('commit')}>
            {busy === 'commit'
              ? '导入中…'
              : `确认导入${preview ? ` ${preview.rows.length} 人` : ''}`}
          </button>
        </div>
      </section>
    </div>
  );
}
