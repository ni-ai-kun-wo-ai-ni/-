import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
test('真实HTTP：提交幂等、旧版本冲突、恶意请求限流及50人并发写入', async (t) => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
  const tag = randomBytes(6).toString('hex');
  const ids: string[] = Array.from({ length: 64 }, () => randomUUID());
  const tokens = ids.map(() => randomBytes(32).toString('hex'));
  let gradeId = '',
    taskId = '',
    teacherId = '';
  try {
    const grade = await db.grade.create({
      data: { name: '并发测试' + tag, classes: { create: { name: '虚构班' } } },
      include: { classes: true },
    });
    gradeId = grade.id;
    const teacher = await db.user.create({
      data: {
        username: 'load_teacher_' + tag,
        name: '虚构教师',
        role: 'TEACHER',
        passwordHash: 'unused',
      },
    });
    teacherId = teacher.id;
    await db.user.createMany({
      data: ids.map((id, i) => ({
        id,
        username: `load_${tag}_${i}`,
        name: '虚构并发同学' + i,
        classId: grade.classes[0].id,
        passwordHash: 'unused',
      })),
    });
    await db.session.createMany({
      data: ids.map((userId, i) => ({
        userId,
        id: tokenHash(tokens[i]),
        expiresAt: new Date(Date.now() + 3600000),
      })),
    });
    const task = await db.collectionTask.create({
      data: {
        title: '并发与防刷验证',
        description: '',
        creatorId: teacher.id,
        gradeId,
        status: 'OPEN',
        allowEdit: true,
        deadline: new Date(Date.now() + 86400000),
        targets: { create: ids.map((userId) => ({ userId })) },
        fields: {
          create: [
            { label: '必填', type: 'TEXT', required: true, position: 0 },
            { label: '多选', type: 'CHECKBOX', options: '["A","B"]', position: 1 },
            { label: '附件', type: 'FILE', position: 2 },
          ],
        },
      },
      include: { fields: { orderBy: { position: 'asc' } } },
    });
    taskId = task.id;
    const [text, choices, file] = task.fields;
    async function post(
      i: number,
      raw: unknown,
      key?: string,
      version?: string,
      extra: Record<string, string> = {},
    ) {
      return fetch(`${base}/api/tasks/${taskId}/submit`, {
        method: 'POST',
        headers: {
          origin: base,
          cookie: `grade_session=${tokens[i]}`,
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotency-Key': key } : {}),
          ...(version ? { 'X-Submission-Version': version } : {}),
          ...extra,
        },
        body: JSON.stringify(raw),
      });
    }
    await t.test('20个同标识并发重试仅保存一次，后续重试返回相同回执，改内容被拒绝', async () => {
      const key = randomUUID(),
        raw = { [text.id]: '仅保存一次' };
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => post(0, raw, key, 'initial')),
      );
      assert.ok(
        responses.every((r) => r.status === 200),
        JSON.stringify(responses.map((r) => r.status)),
      );
      const receipts = await Promise.all(responses.map((r) => r.json()));
      assert.ok(
        receipts.every(
          (r) => JSON.stringify(r.submission) === JSON.stringify(receipts[0].submission),
        ),
      );
      assert.equal(await db.submission.count({ where: { taskId, userId: ids[0] } }), 1);
      assert.equal(await db.submissionRequest.count({ where: { taskId, userId: ids[0] } }), 1);
      assert.equal((await post(0, { [text.id]: '不同内容' }, key, 'initial')).status, 409);
      assert.equal((await post(0, raw, key, 'initial')).status, 200);
    });
    await t.test('同标识附件重传不新增附件，附件字节变化不能冒充重试', async () => {
      const key = randomUUID();
      async function upload(content: string) {
        const form = new FormData();
        form.set('answers', JSON.stringify({ [text.id]: '附件幂等' }));
        form.set('files:' + file.id, new File([content], 'a.txt'));
        return fetch(`${base}/api/tasks/${taskId}/submit`, {
          method: 'POST',
          headers: {
            origin: base,
            cookie: `grade_session=${tokens[1]}`,
            'Idempotency-Key': key,
            'X-Submission-Version': 'initial',
          },
          body: form,
        });
      }
      assert.equal((await upload('same')).status, 200);
      assert.equal((await upload('same')).status, 200);
      assert.equal(await db.attachment.count({ where: { taskId, userId: ids[1] } }), 1);
      assert.equal((await upload('changed')).status, 409);
    });
    await t.test('两个旧页面同时修改只允许一个成功，不覆盖先保存的新答案', async () => {
      const first = await post(2, { [text.id]: '初稿' }, randomUUID(), 'initial');
      assert.equal(first.status, 200);
      const version = (await first.json()).submission.updatedAt;
      const results = await Promise.all(
        ['页面A', '页面B'].map((value) => post(2, { [text.id]: value }, randomUUID(), version)),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await post(2, { [text.id]: '覆盖' }, randomUUID(), 'initial')).status, 409);
    });
    await t.test('非法答案、重复多选和超大JSON失败均无半份提交或幂等回执', async () => {
      for (const raw of [
        {},
        { [text.id]: 'x', [choices.id]: ['A', 'A'] },
        { [text.id]: 'x', unknown: '伪造' },
      ]) {
        assert.equal((await post(4, raw, randomUUID(), 'initial')).status, 400);
      }
      assert.equal((await post(4, { [text.id]: 'x'.repeat(300 * 1024) })).status, 413);
      assert.equal(await db.submission.count({ where: { taskId, userId: ids[4] } }), 0);
      assert.equal(await db.submissionRequest.count({ where: { taskId, userId: ids[4] } }), 0);
    });
    await t.test('按账号限流，轮换伪造代理IP不能绕过；拒绝响应带Retry-After', async () => {
      for (let i = 0; i < 40; i++)
        assert.equal(
          (await post(3, {}, undefined, undefined, { 'x-forwarded-for': `1.2.3.${i}` })).status,
          400,
        );
      const blocked = await post(3, {}, undefined, undefined, { 'x-forwarded-for': '9.9.9.9' });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      assert.equal(await db.submission.count({ where: { taskId, userId: ids[3] } }), 0);
      assert.equal(
        (await post(5, { [text.id]: '其他正常账号' }, randomUUID(), 'initial')).status,
        200,
      );
    });
    await t.test('50个不同学生同时提交：完整写入、唯一记录、保存答案不串号', async () => {
      const start = performance.now();
      const results = await Promise.all(
        ids.slice(10, 60).map(async (_id, offset) => {
          const began = performance.now();
          const response = await post(
            offset + 10,
            { [text.id]: '答案' + offset },
            randomUUID(),
            'initial',
          );
          return { status: response.status, ms: performance.now() - began };
        }),
      );
      assert.ok(
        results.every((r) => r.status === 200),
        JSON.stringify(results.map((r) => r.status)),
      );
      const submissions = await db.submission.findMany({
        where: { taskId, userId: { in: ids.slice(10, 60) } },
        include: { answers: true },
      });
      assert.equal(submissions.length, 50);
      for (const sub of submissions)
        assert.equal(
          sub.answers.find((answer) => answer.fieldId === text.id)?.value,
          JSON.stringify('答案' + (ids.indexOf(sub.userId) - 10)),
        );
      const timings = results.map((r) => r.ms).sort((a, b) => a - b);
      const report = {
        concurrent: 50,
        success: 50,
        totalMs: Math.round(performance.now() - start),
        p50Ms: Math.round(timings[24]),
        p95Ms: Math.round(timings[47]),
        maxMs: Math.round(timings[49]),
        payload: '已登录学生的3字段文字表单，独立本机SQLite测试库，不含公网传输及大附件',
      };
      writeFileSync('.local/resilience-load-result.json', JSON.stringify(report, null, 2));
      console.log('并发实测', JSON.stringify(report));
    });
  } finally {
    if (taskId) {
      await db.submission.deleteMany({ where: { taskId } });
      await db.collectionTask.deleteMany({ where: { id: taskId } });
    }
    await db.user.deleteMany({ where: { id: { in: [...ids, teacherId] } } });
    if (gradeId) {
      await db.class.deleteMany({ where: { gradeId } });
      await db.grade.delete({ where: { id: gradeId } });
    }
    await db.$disconnect();
  }
});
