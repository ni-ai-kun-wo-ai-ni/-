import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { compare } from 'bcryptjs';
import type { Bootstrap, Person } from '../src/lib/types';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
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
  const response = await request('login', '', { username, password });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie')!.split(';')[0];
}
test('教师管理学生账号：创建、权限、删除关联与 Session 失效', async (t) => {
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
    '本测试只允许访问本机，不经公网发送凭据',
  );
  const createdIds: string[] = [];
  const taskIds: string[] = [];
  try {
    const teacher = await login('teacher001');
    const monitor = await login('monitor001');
    const student = await login('student001');
    const bootstrap: Bootstrap = await (await request('bootstrap', teacher)).json();
    const token = randomUUID().replaceAll('-', '').slice(0, 16);
    const input = {
      name: '账号管理测试同学',
      username: `test_${token}`,
      studentNumber: `test_${token}`,
      classId: bootstrap.grades[0].classes[0].id,
      isClassOfficer: true,
      password: 'NewStudent2026!Test',
    };
    await t.test('未登录、普通学生、班干部均不能创建账号', async () => {
      for (const [cookie, status] of [
        ['', 401],
        [student, 403],
        [monitor, 403],
      ] as const)
        assert.equal((await request('students', cookie, input)).status, status);
    });
    await t.test('拒绝无效字段、弱密码、伪造教师身份和不存在的班级', async () => {
      for (const payload of [
        { ...input, name: '  ' },
        { ...input, username: '有空 格' },
        { ...input, password: '1234567890' },
        { ...input, password: 'Demo2026!' },
        { ...input, password: '汉'.repeat(30) + 'Aa1' },
        { ...input, role: 'TEACHER' },
      ])
        assert.equal((await request('students', teacher, payload)).status, 400);
      assert.equal(
        (await request('students', teacher, { ...input, classId: 'no-such-class' })).status,
        400,
      );
      assert.equal((await request('students', teacher, input, 'https://evil.example')).status, 403);
    });
    let person: Person;
    await t.test('教师可创建学生和班干部，密码哈希保存且响应不泄露密码', async () => {
      const response = await request('students', teacher, input);
      assert.equal(response.status, 200);
      person = await response.json();
      createdIds.push(person.id);
      assert.equal(person.role, 'STUDENT');
      assert.equal(person.isClassOfficer, true);
      assert.equal(person.classId, input.classId);
      assert.ok(!JSON.stringify(person).includes('password'));
      const stored = await db.user.findUniqueOrThrow({ where: { id: person.id } });
      assert.notEqual(stored.passwordHash, input.password);
      assert.ok(await compare(input.password, stored.passwordHash));
      const home: Bootstrap = await (await request('bootstrap', teacher)).json();
      assert.ok(home.students.some((s) => s.id === person.id));
    });
    const id = createdIds[0];
    assert.ok(id);
    await t.test('重复账号和学号返回明确错误，不覆盖已有账号', async () => {
      assert.equal(
        (await request('students', teacher, { ...input, studentNumber: `other_${token}` })).status,
        409,
      );
      assert.equal(
        (await request('students', teacher, { ...input, username: `other_${token}` })).status,
        409,
      );
    });
    const cookie = await login(input.username, input.password);
    await t.test('新增学生不自动加入历史任务，普通身份不能提权', async () => {
      const home: Bootstrap = await (await request('bootstrap', cookie)).json();
      assert.equal(home.tasks.length, 0);
      assert.equal((await request('students', cookie, input)).status, 403);
    });
    const task = await db.collectionTask.create({
      data: {
        title: '测试删除关联',
        description: '独立测试',
        gradeId: bootstrap.grades[0].id,
        creatorId: bootstrap.user.id,
        status: 'OPEN',
        deadline: new Date(Date.now() + 86400000),
        targets: { create: [{ userId: id }, { userId: bootstrap.students[0].id }] },
        fields: { create: { label: '测试字段', type: 'TEXT', position: 0 } },
      },
      include: { fields: true },
    });
    taskIds.push(task.id);
    await db.submission.create({
      data: {
        taskId: task.id,
        userId: id,
        answers: { create: { fieldId: task.fields[0].id, value: '"测试答案"' } },
      },
    });
    await t.test('非教师不能删除账号，教师也不能删除教师或跳过账号确认', async () => {
      for (const [c, status] of [
        ['', 401],
        [student, 403],
        [monitor, 403],
        [cookie, 403],
      ] as const)
        assert.equal(
          (await request(`students/${id}/delete`, c, { confirmUsername: input.username })).status,
          status,
        );
      assert.equal(
        (
          await request(`students/${bootstrap.user.id}/delete`, teacher, {
            confirmUsername: bootstrap.user.username,
          })
        ).status,
        403,
      );
      assert.equal(
        (await request(`students/${id}/delete`, teacher, { confirmUsername: 'wrong' })).status,
        400,
      );
      assert.equal(
        (
          await request(
            `students/${id}/delete`,
            teacher,
            { confirmUsername: input.username },
            'https://evil.example',
          )
        ).status,
        403,
      );
      assert.ok(await db.user.findUnique({ where: { id } }));
    });
    await t.test('删除清理提交/答案/任务目标/Session，保留任务和其他学生', async () => {
      assert.equal(
        (await request(`students/${id}/delete`, teacher, { confirmUsername: input.username }))
          .status,
        200,
      );
      assert.equal(await db.user.count({ where: { id } }), 0);
      assert.equal(await db.session.count({ where: { userId: id } }), 0);
      assert.equal(await db.submission.count({ where: { userId: id } }), 0);
      assert.equal(await db.submissionAnswer.count({ where: { fieldId: task.fields[0].id } }), 0);
      assert.equal(await db.taskTarget.count({ where: { userId: id } }), 0);
      assert.equal(await db.collectionTask.count({ where: { id: task.id } }), 1);
      assert.equal(await db.taskTarget.count({ where: { taskId: task.id } }), 1);
      assert.equal((await request('bootstrap', cookie)).status, 401);
      assert.equal(
        (await request('login', '', { username: input.username, password: input.password })).status,
        401,
      );
      const report = await (await request(`tasks/${task.id}/report`, teacher)).json();
      assert.equal(report.total, 1);
      assert.equal(report.submitted, 0);
      assert.equal(
        (await request(`students/${id}/delete`, teacher, { confirmUsername: input.username }))
          .status,
        404,
      );
    });
    await t.test('可创建普通学生，已删除的登录账号和学号可重新使用', async () => {
      const response = await request('students', teacher, { ...input, isClassOfficer: false });
      assert.equal(response.status, 200);
      const second: Person = await response.json();
      createdIds.push(second.id);
      assert.equal(second.isClassOfficer, false);
    });
  } finally {
    await db.submission.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.collectionTask.deleteMany({ where: { id: { in: taskIds } } });
    await db.user.deleteMany({ where: { id: { in: createdIds } } });
    await db.$disconnect();
  }
});
