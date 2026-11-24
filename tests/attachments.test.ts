import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import ExcelJS from 'exceljs';
import { tokenHash } from '../src/lib/auth';
import type { AttachmentInfo } from '../src/lib/attachment-types';
import { MAX_FILE_BYTES, MAX_SUBMISSION_BYTES } from '../src/lib/attachment-types';
import { readSubmission } from '../src/lib/attachments';

const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlV8AAAAASUVORK5CYII=',
  'base64',
);
async function request(path: string, cookie = '', body?: unknown) {
  return fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin: base, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
type Upload = { fieldId: string; name: string; bytes: Uint8Array };
async function submit(
  taskId: string,
  cookie: string,
  answers: unknown,
  files: Upload[] = [],
  origin = base,
) {
  const form = new FormData();
  form.set('answers', JSON.stringify(answers));
  for (const file of files)
    form.append(`files:${file.fieldId}`, new Blob([file.bytes as BlobPart]), file.name);
  return fetch(`${base}/api/tasks/${taskId}/submit`, {
    method: 'POST',
    headers: { cookie, origin },
    body: form,
  });
}
test('文件与照片：上传、下载、权限隔离、修改和级联清理', async (t) => {
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
    '附件测试仅在本机独立数据库执行',
  );
  const tag = randomBytes(6).toString('hex'),
    users: string[] = [],
    tasks: string[] = [];
  let gradeId = '';
  const passwordHash = await hash('AttachmentTest2026!', 12);
  async function actor(role: string, classId: string | null, isClassOfficer = false) {
    const user = await db.user.create({
      data: {
        username: `files_${tag}_${users.length}`,
        name: '虚构附件测试',
        passwordHash,
        role,
        classId,
        isClassOfficer,
      },
    });
    users.push(user.id);
    const token = randomBytes(32).toString('hex');
    await db.session.create({
      data: { id: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + 3600000) },
    });
    return { user, cookie: `grade_session=${token}` };
  }
  try {
    const grade = await db.grade.create({ data: { name: `附件测试_${tag}` } });
    gradeId = grade.id;
    const c1 = await db.class.create({ data: { gradeId, name: '附件1班' } }),
      c2 = await db.class.create({ data: { gradeId, name: '附件2班' } });
    const teacher = await actor('TEACHER', null),
      student = await actor('STUDENT', c1.id),
      other = await actor('STUDENT', c1.id),
      officer = await actor('STUDENT', c1.id, true),
      officer2 = await actor('STUDENT', c2.id, true),
      outsider = await actor('STUDENT', c2.id);
    const draft = await request('tasks', teacher.cookie, {
      title: '附件任务',
      description: '',
      gradeId,
      deadline: new Date(Date.now() + 86400000).toISOString(),
      allowEdit: true,
      officerCanView: false,
      targetIds: [student.user.id, other.user.id, officer.user.id, officer2.user.id],
      fields: [
        { label: '文档', type: 'FILE', required: true, options: [] },
        { label: '照片', type: 'PHOTO', required: false, options: [] },
        { label: '备注', type: 'TEXT', required: true, options: [] },
      ],
    });
    assert.equal(draft.status, 200);
    const { id } = await draft.json();
    tasks.push(id);
    const task = await db.collectionTask.findUniqueOrThrow({
      where: { id },
      include: { fields: { orderBy: { position: 'asc' } } },
    });
    const [doc, photo, text] = task.fields;
    const answers = { [text.id]: '附件测试' };
    const docUpload = {
        fieldId: doc.id,
        name: '中文资料.txt',
        bytes: Buffer.from('保留原始文件内容'),
      },
      photoUpload = { fieldId: photo.id, name: '照片.png', bytes: png };
    let files: AttachmentInfo[] = [];
    await t.test('草稿、非填写对象、教师、未登录和跨站不能上传', async () => {
      assert.equal((await submit(id, student.cookie, answers, [docUpload])).status, 403);
      assert.equal(
        (await request(`tasks/${id}/status`, teacher.cookie, { status: 'OPEN' })).status,
        200,
      );
      for (const [cookie, status] of [
        ['', 401],
        [teacher.cookie, 403],
        [outsider.cookie, 403],
      ] as const)
        assert.equal((await submit(id, cookie, answers, [docUpload])).status, status);
      assert.equal(
        (await submit(id, student.cookie, answers, [docUpload], 'https://evil.example')).status,
        403,
      );
      assert.equal(await db.attachment.count({ where: { taskId: id } }), 0);
    });
    await t.test('必填、照片内容、大小、数量、格式和未知字段均在后端校验，失败无残留', async () => {
      assert.equal((await submit(id, student.cookie, answers)).status, 400);
      assert.equal(
        (
          await submit(id, student.cookie, answers, [
            docUpload,
            { ...photoUpload, bytes: Buffer.from('伪装照片') },
          ])
        ).status,
        400,
      );
      assert.equal(
        (
          await submit(id, student.cookie, answers, [
            { ...docUpload, bytes: new Uint8Array(MAX_FILE_BYTES + 1) },
          ])
        ).status,
        413,
      );
      assert.equal(
        (
          await submit(
            id,
            student.cookie,
            answers,
            Array.from({ length: 6 }, () => docUpload),
          )
        ).status,
        400,
      );
      assert.equal(
        (await submit(id, student.cookie, answers, [{ ...docUpload, name: '程序.exe' }])).status,
        400,
      );
      assert.equal(
        (await submit(id, student.cookie, answers, [{ ...docUpload, fieldId: text.id }])).status,
        400,
      );
      assert.equal(await db.attachment.count({ where: { taskId: id } }), 0);
    });
    await t.test('同一提交包含多个文件和照片，本人和教师可下载，照片可查看', async () => {
      assert.equal(
        (
          await submit(id, student.cookie, answers, [
            docUpload,
            { ...docUpload, name: '第二份.txt' },
            photoUpload,
          ])
        ).status,
        200,
      );
      const detail = await (await request(`tasks/${id}`, student.cookie)).json();
      files = detail.submission.attachments;
      assert.equal(files.length, 3);
      assert.ok(files.every((f) => !('data' in f)));
      const file = files.find((f) => f.name === docUpload.name)!;
      for (const cookie of [student.cookie, teacher.cookie]) {
        const response = await request(`attachments/${file.id}`, cookie);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), docUpload.bytes);
        assert.match(response.headers.get('content-disposition')!, /^attachment/);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      }
      const image = files.find((f) => f.fieldId === photo.id)!;
      const response = await request(`attachments/${image.id}?preview=1`, teacher.cookie);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.match(response.headers.get('content-disposition')!, /^inline/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    });
    await t.test('匿名、其他学生、未授权班干部不能下载，也不能从统计中取得附件信息', async () => {
      for (const [cookie, status] of [
        ['', 401],
        [other.cookie, 403],
        [officer.cookie, 403],
        [officer2.cookie, 403],
      ] as const)
        assert.equal((await request(`attachments/${files[0].id}`, cookie)).status, status);
      const report = await (await request(`tasks/${id}/report`, officer.cookie)).json();
      assert.equal(report.canView, false);
      assert.ok(!JSON.stringify(report).includes(files[0].id));
      assert.ok(!JSON.stringify(report).includes(docUpload.name));
    });
    await t.test('教师授权后班干部仅可访问本班附件，同一会话撤权立即失效', async () => {
      await db.collectionTask.update({ where: { id }, data: { officerCanView: true } });
      assert.equal((await request(`attachments/${files[0].id}`, officer.cookie)).status, 200);
      assert.equal((await request(`attachments/${files[0].id}`, officer2.cookie)).status, 403);
      await db.user.update({ where: { id: officer.user.id }, data: { isClassOfficer: false } });
      assert.equal((await request(`attachments/${files[0].id}`, officer.cookie)).status, 403);
    });
    await t.test('附件ID不能跨学生、字段或任务引用；失败事务回滚且不覆盖已有提交', async () => {
      assert.equal(
        (await submit(id, other.cookie, { ...answers, [doc.id]: [files[0].id] })).status,
        403,
      );
      const document = files.find((f) => f.fieldId === doc.id)!;
      assert.equal(
        (
          await submit(id, student.cookie, {
            ...answers,
            [doc.id]: [document.id],
            [photo.id]: [document.id],
          })
        ).status,
        403,
      );
      assert.equal((await submit(id, student.cookie, {}, [docUpload])).status, 400);
      assert.equal(
        await db.attachment.count({ where: { taskId: id, userId: student.user.id } }),
        3,
      );
      const clone = await db.collectionTask.create({
        data: {
          title: '其他任务',
          description: '',
          gradeId,
          creatorId: teacher.user.id,
          deadline: new Date(Date.now() + 86400000),
          status: 'OPEN',
          targets: { create: { userId: student.user.id } },
          fields: { create: { label: '其他字段', type: 'FILE', required: true, position: 0 } },
        },
        include: { fields: true },
      });
      tasks.push(clone.id);
      assert.equal(
        (await submit(clone.id, student.cookie, { [clone.fields[0].id]: [document.id] })).status,
        403,
      );
    });
    await t.test('教师统计可查看附件名称，Excel包含带权限校验的下载链接', async () => {
      const report = await (await request(`tasks/${id}/report`, teacher.cookie)).json();
      assert.equal(
        report.rows.find((r: { id: string }) => r.id === student.user.id).submission.attachments
          .length,
        3,
      );
      const response = await request(`tasks/${id}/export`, teacher.cookie);
      assert.equal(response.status, 200);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await response.arrayBuffer());
      assert.match(book.worksheets[0].getCell('D2').text, /中文资料.txt/);
      assert.match(book.worksheets[0].getCell('D2').text, /\/api\/attachments\//);
    });
    await t.test('截止或禁止修改后不能上传或替换附件', async () => {
      await db.collectionTask.update({ where: { id }, data: { allowEdit: false } });
      assert.equal((await submit(id, student.cookie, answers, [docUpload])).status, 403);
      await db.collectionTask.update({
        where: { id },
        data: { allowEdit: true, deadline: new Date(Date.now() - 1000) },
      });
      assert.equal((await submit(id, student.cookie, answers, [docUpload])).status, 400);
      assert.equal(await db.attachment.count({ where: { taskId: id } }), 3);
      await db.collectionTask.update({
        where: { id },
        data: { deadline: new Date(Date.now() + 86400000) },
      });
    });
    await t.test('保存修改可保留照片并替换文档，旧附件即刻删除', async () => {
      const image = files.find((f) => f.fieldId === photo.id)!;
      const documents = files.filter((f) => f.fieldId === doc.id);
      assert.equal(
        (
          await submit(id, student.cookie, { ...answers, [photo.id]: [image.id] }, [
            { ...docUpload, name: '更新资料.txt' },
          ])
        ).status,
        200,
      );
      assert.equal(await db.attachment.count({ where: { taskId: id } }), 2);
      for (const file of documents)
        assert.equal((await request(`attachments/${file.id}`, teacher.cookie)).status, 404);
      assert.equal((await request(`attachments/${image.id}`, student.cookie)).status, 200);
    });
    await t.test('单个文件支持超过旧10MB上限，80MB总请求限制仍有效', async () => {
      const largeTask = await db.collectionTask.create({
        data: {
          title: '大文件测试',
          description: '',
          gradeId,
          creatorId: teacher.user.id,
          deadline: new Date(Date.now() + 86400000),
          status: 'OPEN',
          targets: { create: { userId: student.user.id } },
          fields: { create: { label: '大文件', type: 'FILE', required: true, position: 0 } },
        },
        include: { fields: true },
      });
      tasks.push(largeTask.id);
      const upload = {
        fieldId: largeTask.fields[0].id,
        name: '大型资料.zip',
        bytes: new Uint8Array(12 * 1024 * 1024),
      };
      assert.equal((await submit(largeTask.id, student.cookie, {}, [upload])).status, 200);
      const saved = await db.attachment.findFirstOrThrow({ where: { taskId: largeTask.id } });
      assert.equal(saved.size, upload.bytes.length);
      const downloaded = await request(`attachments/${saved.id}`, teacher.cookie);
      assert.equal(downloaded.status, 200);
      assert.equal((await downloaded.arrayBuffer()).byteLength, upload.bytes.length);
      await assert.rejects(
        readSubmission(
          new Request(`${base}/api/tasks/${id}/submit`, {
            method: 'POST',
            headers: {
              'Content-Type': 'multipart/form-data; boundary=test',
              'Content-Length': String(MAX_SUBMISSION_BYTES + 128 * 1024 + 1),
            },
            body: 'x',
          }),
          task.fields,
        ),
        (error: unknown) =>
          !!error && typeof error === 'object' && 'status' in error && error.status === 413,
      );
    });
    await t.test('手写签名支持必填、预览下载、重签替换，并拒绝伪造或多份签名', async () => {
      const signedTask = await db.collectionTask.create({
        data: {
          title: '签名测试',
          description: '',
          gradeId,
          creatorId: teacher.user.id,
          deadline: new Date(Date.now() + 86400000),
          status: 'OPEN',
          targets: { create: [{ userId: student.user.id }, { userId: other.user.id }] },
          fields: { create: { label: '本人签名', type: 'SIGNATURE', required: true, position: 0 } },
        },
        include: { fields: true },
      });
      tasks.push(signedTask.id);
      const field = signedTask.fields[0];
      const signature = { fieldId: field.id, name: '手写签名.png', bytes: png };
      assert.equal((await submit(signedTask.id, student.cookie, {})).status, 400);
      assert.equal(
        (
          await submit(signedTask.id, student.cookie, {}, [
            { ...signature, bytes: Buffer.from('伪造签名') },
          ])
        ).status,
        400,
      );
      assert.equal(
        (await submit(signedTask.id, student.cookie, {}, [signature, signature])).status,
        400,
      );
      const tooLarge = Buffer.alloc(1024 * 1024 + 1);
      png.copy(tooLarge);
      assert.equal(
        (await submit(signedTask.id, student.cookie, {}, [{ ...signature, bytes: tooLarge }]))
          .status,
        400,
      );
      assert.equal(await db.attachment.count({ where: { taskId: signedTask.id } }), 0);
      assert.equal((await submit(signedTask.id, student.cookie, {}, [signature])).status, 200);
      const saved = await db.attachment.findFirstOrThrow({ where: { taskId: signedTask.id } });
      const viewed = await request(`attachments/${saved.id}?preview=1`, teacher.cookie);
      assert.equal(viewed.status, 200);
      assert.equal(viewed.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await viewed.arrayBuffer()), png);
      assert.equal((await request(`attachments/${saved.id}`, other.cookie)).status, 403);
      assert.equal(
        (await submit(signedTask.id, other.cookie, { [field.id]: [saved.id] })).status,
        403,
      );
      assert.equal((await submit(signedTask.id, student.cookie, { [field.id]: [] })).status, 400);
      assert.equal((await request(`attachments/${saved.id}`, teacher.cookie)).status, 200);
      const report = await (await request(`tasks/${signedTask.id}/report`, teacher.cookie)).json();
      assert.equal(report.task.fields[0].type, 'SIGNATURE');
      assert.equal(
        report.rows.find((row: { id: string }) => row.id === student.user.id).submission.attachments
          .length,
        1,
      );
      assert.equal(
        (await submit(signedTask.id, student.cookie, {}, [{ ...signature, name: '重新签名.png' }]))
          .status,
        200,
      );
      assert.equal((await request(`attachments/${saved.id}`, teacher.cookie)).status, 404);
      assert.equal(await db.attachment.count({ where: { taskId: signedTask.id } }), 1);
    });
    await t.test('删除学生或任务清理对应附件，其他学生附件保留', async () => {
      assert.equal((await submit(id, other.cookie, answers, [docUpload])).status, 200);
      const otherFile = await db.attachment.findFirstOrThrow({
        where: { taskId: id, userId: other.user.id },
      });
      assert.equal(
        (
          await request(`students/${other.user.id}/delete`, teacher.cookie, {
            confirmUsername: other.user.username,
          })
        ).status,
        200,
      );
      assert.equal((await request(`attachments/${otherFile.id}`, teacher.cookie)).status, 404);
      assert.equal(await db.attachment.count({ where: { taskId: id } }), 2);
      assert.equal(
        (await request(`tasks/${id}/delete`, teacher.cookie, { confirmTitle: task.title })).status,
        200,
      );
      assert.equal(await db.attachment.count({ where: { taskId: id } }), 0);
    });
  } finally {
    await db.submission.deleteMany({ where: { taskId: { in: tasks } } });
    await db.collectionTask.deleteMany({ where: { id: { in: tasks } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    if (gradeId) {
      await db.class.deleteMany({ where: { gradeId } });
      await db.grade.deleteMany({ where: { id: gradeId } });
    }
    await db.$disconnect();
  }
});
