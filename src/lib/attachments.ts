import type { FormField, Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { HttpError } from './auth';
import { accessibleTask, isOpen } from './access';
import {
  FILE_ACCEPT,
  MAX_FIELD_FILES,
  MAX_FILE_BYTES,
  MAX_SUBMISSION_BYTES,
  attachmentSelect,
} from './attachment-types';

type UploadedFile = {
  fieldId: string;
  name: string;
  mime: string;
  size: number;
  data: Uint8Array<ArrayBuffer>;
};
function imageMime(data: Uint8Array) {
  const b = Buffer.from(data);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString())) return 'image/gif';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return null;
}

export async function readSubmission(request: Request, fields: FormField[]) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data'))
    return { raw: await request.json(), uploads: [] as UploadedFile[] };
  const limit = MAX_SUBMISSION_BYTES + 128 * 1024;
  if (Number(request.headers.get('content-length')) > limit)
    throw new HttpError(413, '每次提交附件总大小不能超过30 MB');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '没有收到提交内容');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, '每次提交附件总大小不能超过30 MB');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
  } catch {
    throw new HttpError(400, '附件上传格式不正确');
  }
  if (form.getAll('answers').length !== 1 || typeof form.get('answers') !== 'string')
    throw new HttpError(400, '提交答案格式不正确');
  const raw: unknown = JSON.parse(String(form.get('answers')));
  const uploads: UploadedFile[] = [];
  for (const [key, value] of form.entries()) {
    if (key === 'answers') continue;
    const fieldId = key.startsWith('files:') ? key.slice(6) : '';
    const field = fields.find((f) => f.id === fieldId && ['FILE', 'PHOTO'].includes(f.type));
    if (!field || !(value instanceof File)) throw new HttpError(400, '包含无效的附件字段');
    if (value.size <= 0 || value.size > MAX_FILE_BYTES)
      throw new HttpError(413, '单个文件须非空且不超过10 MB');
    if (uploads.filter((f) => f.fieldId === fieldId).length >= MAX_FIELD_FILES)
      throw new HttpError(400, '每个上传字段最多5个文件');
    const name = value.name
      .split(/[\\/]/)
      .pop()!
      .replace(/[\x00-\x1f\x7f]/g, '')
      .trim();
    if (!name || name.length > 180) throw new HttpError(400, '文件名为空或过长');
    const extension = '.' + name.split('.').pop()!.toLowerCase();
    if (!FILE_ACCEPT.split(',').includes(extension))
      throw new HttpError(400, '仅支持常用文档、图片和ZIP压缩包');
    const data = new Uint8Array(await value.arrayBuffer());
    const detectedImage = imageMime(data);
    if (field.type === 'PHOTO' && !detectedImage)
      throw new HttpError(400, '照片须为有效的JPG、PNG、GIF或WebP图片');
    uploads.push({
      fieldId,
      name,
      mime: detectedImage || 'application/octet-stream',
      size: data.byteLength,
      data,
    });
  }
  return { raw, uploads };
}

export async function prepareAttachments(
  tx: Prisma.TransactionClient,
  taskId: string,
  userId: string,
  fields: FormField[],
  raw: unknown,
  uploads: UploadedFile[],
) {
  const input = z.record(z.string(), z.unknown()).parse(raw);
  const previous = await tx.attachment.findMany({
    where: { taskId, userId },
    select: attachmentSelect,
  });
  const retained: string[] = [];
  let total = 0;
  for (const field of fields.filter((f) => ['FILE', 'PHOTO'].includes(f.type))) {
    const value = input[field.id];
    const ids =
      value === undefined || value === ''
        ? []
        : z.array(z.string().min(1).max(100)).max(MAX_FIELD_FILES).parse(value);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, '附件不能重复');
    for (const id of ids) {
      const own = previous.find((f) => f.id === id && f.fieldId === field.id);
      if (!own) throw new HttpError(403, '不能引用他人、其他任务或其他字段的附件');
      total += own.size;
      retained.push(id);
    }
    const additions = uploads.filter((f) => f.fieldId === field.id);
    if (ids.length + additions.length > MAX_FIELD_FILES)
      throw new HttpError(400, '每个上传字段最多5个文件');
    for (const file of additions) {
      total += file.size;
      if (total > MAX_SUBMISSION_BYTES) throw new HttpError(413, '每次提交附件总大小不能超过30 MB');
      const created = await tx.attachment.create({
        data: { ...file, taskId, userId },
        select: { id: true },
      });
      ids.push(created.id);
      retained.push(created.id);
    }
    input[field.id] = ids;
  }
  if (total > MAX_SUBMISSION_BYTES) throw new HttpError(413, '每次提交附件总大小不能超过30 MB');
  return { input, retained };
}

export async function downloadAttachment(actor: User, id: string, preview: boolean) {
  const file = await db.attachment.findUnique({
    where: { id },
    select: {
      ...attachmentSelect,
      taskId: true,
      userId: true,
      user: { select: { classId: true } },
      task: {
        select: { status: true, officerCanView: true, targets: { select: { userId: true } } },
      },
    },
  });
  if (!file) throw new HttpError(404, '附件不存在或已被删除');
  if (actor.role !== 'TEACHER') {
    if (file.userId === actor.id) await accessibleTask(actor, file.taskId);
    else if (
      !actor.isClassOfficer ||
      !actor.classId ||
      file.user.classId !== actor.classId ||
      !file.task.officerCanView ||
      file.task.status === 'DRAFT' ||
      !file.task.targets.some((t) => t.userId === file.userId)
    )
      throw new HttpError(403, '无权查看此附件');
  }
  const bytes = await db.attachment.findUnique({ where: { id }, select: { data: true } });
  if (!bytes) throw new HttpError(404, '附件已被删除');
  return new Response(new Uint8Array(bytes.data), {
    headers: {
      'Content-Type':
        preview && file.mime.startsWith('image/') ? file.mime : 'application/octet-stream',
      'Content-Disposition': `${preview && file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(file.size),
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

export async function assertSubmittable(
  tx: Prisma.TransactionClient,
  taskId: string,
  userId: string,
) {
  const fresh = await tx.collectionTask.findUniqueOrThrow({ where: { id: taskId } });
  if (!isOpen(fresh)) throw new HttpError(400, '任务未开放或已截止');
  if (!(await tx.taskTarget.findUnique({ where: { taskId_userId: { taskId, userId } } })))
    throw new HttpError(403, '不是该任务的填写对象');
  const existing = await tx.submission.findUnique({ where: { taskId_userId: { taskId, userId } } });
  if (existing && !fresh.allowEdit) throw new HttpError(403, '此任务不允许修改提交');
  return existing;
}
