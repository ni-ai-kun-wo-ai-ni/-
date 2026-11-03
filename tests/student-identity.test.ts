import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import type { Bootstrap, Person, Report } from '../src/lib/types';
const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const passwords: Record<string, string> = process.env.TEST_ACCOUNTS_FILE
  ? JSON.parse(readFileSync(process.env.TEST_ACCOUNTS_FILE, 'utf8'))
  : {};
async function request(
  path: string,
  cookie = '',
  body?: unknown,
  origin = process.env.TEST_ORIGIN || base,
) {
  return fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(username: string, password = passwords[username] || 'Demo2026!') {
  const r = await request('login', '', { username, password });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie')!.split(';')[0];
}
test('学生与班干部互转：教师权限、同一 Session 即时升级和撤权', async (t) => {
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
    '身份测试仅允许本机，不经公网发送凭据',
  );
  const userIds: string[] = [];
  let taskId = '';
  try {
    const teacher = await login('teacher001'),
      monitor = await login('monitor001'),
      ordinary = await login('student001');
    const home: Bootstrap = await (await request('bootstrap', teacher)).json();
    const source = home.students.find((s) => s.username === 'monitor001')!,
      other = home.students.find((s) => s.username === 'monitor002')!;
    const tag = randomUUID().replaceAll('-', '');
    const password = 'IdentityTest2026!';
    const passwordHash = await hash(password, 12);
    const student = await db.user.create({
      data: {
        username: `identity_${tag}`,
        studentNumber: `identity_${tag}`,
        name: '虚构身份测试同学',
        passwordHash,
        classId: source.classId,
      },
    });
    userIds.push(student.id);
    const unassigned = await db.user.create({
      data: { username: `unassigned_${tag}`, name: '虚构未分班同学', passwordHash },
    });
    userIds.push(unassigned.id);
    const cookie = await login(student.username, password);
    const task = await db.collectionTask.create({
      data: {
        title: '身份变更权限测试',
        description: '独立测试',
        creatorId: home.user.id,
        gradeId: source.class!.gradeId,
        status: 'OPEN',
        deadline: new Date(Date.now() + 86400000),
        officerCanView: true,
        targets: { create: [{ userId: student.id }, { userId: source.id }, { userId: other.id }] },
        fields: { create: { label: '测试字段', type: 'TEXT', position: 0 } },
      },
      include: { fields: true },
    });
    taskId = task.id;
    const submission = await db.submission.create({
      data: {
        taskId,
        userId: student.id,
        answers: { create: { fieldId: task.fields[0].id, value: '"保留答案"' } },
      },
    });
    const payload = { isClassOfficer: true, fromClassId: student.classId };
    await t.test('学生和班干部不能自行升级或修改他人，未登录/跨站请求被拒绝', async () => {
      for (const [c, status] of [
        ['', 401],
        [cookie, 403],
        [ordinary, 403],
        [monitor, 403],
      ] as const)
        assert.equal((await request(`students/${student.id}/identity`, c, payload)).status, status);
      assert.equal(
        (await request(`students/${student.id}/identity`, teacher, payload, 'https://evil.example'))
          .status,
        403,
      );
    });
    await t.test('拒绝教师对象、无效参数、伪造教师角色、班级过期和未分班晋升', async () => {
      assert.equal(
        (
          await request(`students/${home.user.id}/identity`, teacher, {
            isClassOfficer: false,
            fromClassId: null,
          })
        ).status,
        403,
      );
      assert.equal((await request('students/not-found/identity', teacher, payload)).status, 404);
      for (const body of [
        { ...payload, isClassOfficer: 'true' },
        { ...payload, role: 'TEACHER' },
        {},
      ])
        assert.equal((await request(`students/${student.id}/identity`, teacher, body)).status, 400);
      assert.equal(
        (
          await request(`students/${student.id}/identity`, teacher, {
            ...payload,
            fromClassId: other.classId,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`students/${unassigned.id}/identity`, teacher, {
            isClassOfficer: true,
            fromClassId: null,
          })
        ).status,
        400,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: student.id } })).isClassOfficer,
        false,
      );
    });
    await t.test('教师晋升后，原 Cookie 可查看本班统计和导出但不能跨班', async () => {
      assert.equal((await request(`tasks/${taskId}/report`, cookie)).status, 403);
      const response = await request(`students/${student.id}/identity`, teacher, payload);
      assert.equal(response.status, 200);
      const updated: Person = await response.json();
      assert.equal(updated.isClassOfficer, true);
      assert.equal(updated.role, 'STUDENT');
      assert.ok(!JSON.stringify(updated).includes('password'));
      const report: Report = await (await request(`tasks/${taskId}/report`, cookie)).json();
      assert.ok(report.rows.length);
      assert.ok(report.rows.every((s) => s.classId === source.classId));
      assert.equal((await request(`tasks/${taskId}/export`, cookie)).status, 200);
      assert.equal(
        (await request(`tasks/${taskId}/report?classId=${other.classId}`, cookie)).status,
        403,
      );
      assert.equal(
        (await request(`tasks/${taskId}/export?classId=${other.classId}`, cookie)).status,
        403,
      );
      const own: Bootstrap = await (await request('bootstrap', cookie)).json();
      assert.equal(own.user.isClassOfficer, true);
      assert.ok(own.officerTasks.some((t) => t.id === taskId));
    });
    await t.test('教师取消干部身份后，原 Cookie 立即不能看班级数据但仍能查看本人提交', async () => {
      const response = await request(`students/${student.id}/identity`, teacher, {
        ...payload,
        isClassOfficer: false,
      });
      assert.equal(response.status, 200);
      assert.equal((await request(`tasks/${taskId}/report`, cookie)).status, 403);
      assert.equal((await request(`tasks/${taskId}/export`, cookie)).status, 403);
      const own: Bootstrap = await (await request('bootstrap', cookie)).json();
      assert.equal(own.user.isClassOfficer, false);
      assert.equal(own.officerTasks.length, 0);
      const detail = await (await request(`tasks/${taskId}`, cookie)).json();
      assert.equal(detail.submission.id, submission.id);
      assert.equal(detail.submission.answers[0].value, '"保留答案"');
      const stored = await db.user.findUniqueOrThrow({ where: { id: student.id } });
      assert.equal(stored.classId, student.classId);
      assert.equal(stored.username, student.username);
      assert.equal(stored.studentNumber, student.studentNumber);
      assert.equal(stored.passwordHash, passwordHash);
    });
    await t.test('身份可反复切换，教师名册及时返回最新身份', async () => {
      for (const isClassOfficer of [true, false]) {
        assert.equal(
          (
            await request(`students/${student.id}/identity`, teacher, {
              ...payload,
              isClassOfficer,
            })
          ).status,
          200,
        );
        const refreshed: Bootstrap = await (await request('bootstrap', teacher)).json();
        assert.equal(
          refreshed.students.find((s) => s.id === student.id)?.isClassOfficer,
          isClassOfficer,
        );
      }
    });
  } finally {
    if (taskId) {
      await db.submission.deleteMany({ where: { taskId } });
      await db.collectionTask.deleteMany({ where: { id: taskId } });
    }
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  }
});
