'use client';
import { useRef, useState } from 'react';
import { dateText, type Submission, type Task } from '@/lib/types';
import {
  FILE_ACCEPT,
  MAX_FIELD_FILES,
  MAX_FILE_BYTES,
  MAX_SUBMISSION_BYTES,
  MAX_FILE_MB,
  MAX_SUBMISSION_MB,
} from '@/lib/attachment-types';
import AttachmentLinks from './attachment-links';
import SignaturePad from './signature-pad';
import AttachmentPicker from './attachment-picker';
import {
  sendSubmission,
  type SubmissionReceipt,
  type UploadProgress,
} from '@/lib/submission-client';
export default function StudentForm({
  task,
  submission,
  done,
}: {
  task: Task;
  submission: Submission | null;
  done: (receipt: SubmissionReceipt) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(submission?.answers?.map((a) => [a.fieldId, JSON.parse(a.value)]) || []),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const inFlight = useRef(false);
  const intent = useRef<{
    fingerprint: string;
    key: string;
    version: string;
    fileObjects: File[];
  } | null>(null);
  const locked = task.displayStatus !== '收集中' || (!!submission && !task.allowEdit);
  return (
    <form
      className="panel form-sheet"
      onSubmit={async (e) => {
        e.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError('');
        try {
          const fingerprint = JSON.stringify([
            answers,
            Object.entries(files).map(([field, selected]) => [
              field,
              selected.map((file) => [file.name, file.size, file.lastModified]),
            ]),
          ]);
          const fileObjects = Object.values(files).flat();
          if (
            intent.current?.fingerprint !== fingerprint ||
            fileObjects.some((file, index) => file !== intent.current?.fileObjects[index])
          )
            intent.current = {
              fingerprint,
              key: crypto.randomUUID(),
              version: submission?.updatedAt || 'initial',
              fileObjects,
            };
          let receipt: SubmissionReceipt;
          if (Object.values(files).some((selected) => selected.length)) {
            const retained = (submission?.attachments || []).filter(
              (file) =>
                Array.isArray(answers[file.fieldId]) &&
                (answers[file.fieldId] as string[]).includes(file.id),
            );
            const total =
              Object.values(files)
                .flat()
                .reduce((sum, file) => sum + file.size, 0) +
              retained.reduce((sum, file) => sum + file.size, 0);
            if (total > MAX_SUBMISSION_BYTES)
              throw new Error(`每次提交附件总大小不能超过${MAX_SUBMISSION_MB} MB`);
            const form = new FormData();
            form.set('answers', JSON.stringify(answers));
            for (const [fieldId, selected] of Object.entries(files))
              for (const file of selected) form.append(`files:${fieldId}`, file);
            setProgress({ phase: 'uploading', percent: 0, loaded: 0, total });
            receipt = await sendSubmission(task.id, form, setProgress, intent.current!);
          } else {
            setProgress({ phase: 'saving', percent: null, loaded: 0, total: 0 });
            receipt = await sendSubmission(task.id, answers, setProgress, intent.current!);
          }
          done(receipt);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
          setProgress(null);
          inFlight.current = false;
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
              {f.type === 'SIGNATURE' ? (
                <>
                  <div
                    className="signature-saved"
                    aria-hidden={!Array.isArray(value) || !value.length}
                  >
                    <AttachmentLinks
                      previewLabel="查看签名"
                      files={(submission?.attachments || []).filter(
                        (file) => file.fieldId === f.id,
                      )}
                    />
                  </div>
                  {!locked && (
                    <SignaturePad
                      id={f.id}
                      label={f.label}
                      disabled={busy}
                      onChange={(file) => {
                        setFiles((previous) => ({ ...previous, [f.id]: file ? [file] : [] }));
                        setAnswers((previous) => ({ ...previous, [f.id]: [] }));
                        setError('');
                      }}
                    />
                  )}
                  {!locked && (
                    <p
                      className="notice signature-status"
                      role="status"
                      aria-hidden={!files[f.id]?.length}
                    >
                      签名已完成，确认提交后保存。需要修改时可清空重写。
                    </p>
                  )}
                </>
              ) : ['FILE', 'PHOTO'].includes(f.type) ? (
                <>
                  <p className="muted">
                    {f.type === 'PHOTO'
                      ? '支持JPG、PNG、GIF、WebP照片，可从手机相册选择。'
                      : '支持PDF、Word、Excel、PPT、文本、图片和ZIP压缩包。'}
                    每题最多5个文件，单个不超过{MAX_FILE_MB} MB，整份提交附件合计不超过
                    {MAX_SUBMISSION_MB} MB。未提交前可移除文件，再选择其他文件替换。
                  </p>
                  <AttachmentLinks
                    files={(submission?.attachments || []).filter(
                      (file) =>
                        file.fieldId === f.id && Array.isArray(value) && value.includes(file.id),
                    )}
                  />
                  {!locked &&
                    (submission?.attachments || [])
                      .filter(
                        (file) =>
                          file.fieldId === f.id && Array.isArray(value) && value.includes(file.id),
                      )
                      .map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          className="text-button danger"
                          onClick={() => change((value as string[]).filter((id) => id !== file.id))}
                        >
                          移除 {file.name}
                        </button>
                      ))}
                  <AttachmentPicker
                    id={f.id}
                    label={f.label}
                    photoOnly={f.type === 'PHOTO'}
                    disabled={locked || busy}
                    onFiles={(picked) => {
                      const selected = [...(files[f.id] || []), ...picked];
                      if (
                        selected.length + (Array.isArray(value) ? value.length : 0) >
                        MAX_FIELD_FILES
                      ) {
                        setError('每个上传字段最多5个文件，请先移除多余文件');
                        return;
                      }
                      if (picked.some((file) => file.size <= 0 || file.size > MAX_FILE_BYTES)) {
                        setError(`单个文件须非空且不超过${MAX_FILE_MB} MB`);
                        return;
                      }
                      const allowed =
                        f.type === 'PHOTO'
                          ? ['.jpg', '.jpeg', '.png', '.gif', '.webp']
                          : FILE_ACCEPT.split(',');
                      if (
                        picked.some(
                          (file) =>
                            !allowed.includes('.' + file.name.split('.').pop()!.toLowerCase()),
                        )
                      ) {
                        setError(
                          f.type === 'PHOTO'
                            ? '请选择JPG、PNG、GIF或WebP照片'
                            : '暂不支持该文件格式，请选择常用文档、图片或ZIP压缩包',
                        );
                        return;
                      }
                      setFiles({ ...files, [f.id]: selected });
                      setError('');
                    }}
                  />
                  {(files[f.id] || []).map((file, index) => (
                    <div className="attachment-pending" key={`${file.name}-${index}`}>
                      <span>{file.name}（待提交）</span>
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() =>
                          setFiles({
                            ...files,
                            [f.id]: files[f.id].filter((_, position) => position !== index),
                          })
                        }
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </>
              ) : ['TEXT', 'NUMBER', 'DATE'].includes(f.type) ? (
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
      {busy && progress && (
        <div className="notice submission-progress" role="status" aria-live="polite">
          <p>
            {progress.phase === 'saving'
              ? '正在确认保存，请保持页面打开…'
              : progress.percent === null
                ? '正在上传附件，请保持页面打开…'
                : `正在上传附件 ${progress.percent}%${progress.total ? `（${(progress.loaded / 1024 / 1024).toFixed(1)} / ${(progress.total / 1024 / 1024).toFixed(1)} MB）` : ''}`}
          </p>
          <progress
            aria-label={progress.phase === 'saving' ? '正在保存提交' : '附件上传进度'}
            max={100}
            value={
              progress.phase === 'uploading' && progress.percent !== null
                ? progress.percent
                : undefined
            }
          />
        </div>
      )}
      {locked ? (
        <p className="notice">
          {task.displayStatus !== '收集中' ? '此任务当前不能填写。' : '已提交，此任务不允许修改。'}
        </p>
      ) : (
        <button disabled={busy}>
          {busy
            ? progress?.phase === 'uploading'
              ? '上传中…'
              : '保存中…'
            : submission
              ? '保存修改'
              : '确认提交 →'}
        </button>
      )}
    </form>
  );
}
