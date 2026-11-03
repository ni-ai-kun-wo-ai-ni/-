import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { compare } from 'bcryptjs';
import type { Bootstrap, Person } from '../src/lib/types';
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
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
test('学号账号和首次改密：强制门禁、密码保存和旧会话失效', async (t) => {
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
    '只允许本机独立测试，不经公网发送密码',
  );
  const ids: string[] = [];
  let taskId = '';
  try {
    const auth = await request('login', '', {
      username: 'teacher001',
      password: passwords.teacher001 || 'Demo2026!',
    });
    assert.equal(auth.status, 200);
    const teacher = cookieOf(auth);
    const home: Bootstrap = await (await request('bootstrap', teacher)).json();
    const cls = home.students[0].class!;
    const tag = randomUUID().replaceAll('-', '').slice(0, 16);
    let student: Person;
    await t.test('教师创建时学号即账号，默认密码仅哈希保存且标记首次改密', async () => {
      const created = await request('students', teacher, {
        name: '虚构首次改密同学',
        studentNumber: `first_${tag}`,
        classId: cls.id,
        isClassOfficer: true,
      });
      assert.equal(created.status, 200);
      student = await created.json();
      ids.push(student.id);
      assert.equal(student.username, student.studentNumber);
      assert.equal(student.mustChangePassword, true);
      const stored = await db.user.findUniqueOrThrow({ where: { id: student.id } });
      assert.notEqual(stored.passwordHash, '123456');
      assert.ok(await compare('123456', stored.passwordHash));
    });
    const user = await db.user.findUniqueOrThrow({ where: { id: ids[0] } });
    const login = () => request('login', '', { username: user.username, password: '123456' });
    const first = await login(),
      second = await login();
    assert.equal(first.status, 200);
    assert.equal((await first.clone().json()).mustChangePassword, true);
    const cookie = cookieOf(first),
      secondCookie = cookieOf(second);
    const task = await db.collectionTask.create({
      data: {
        title: '首次改密门禁测试',
        description: '独立测试',
        gradeId: cls.gradeId,
        creatorId: home.user.id,
        status: 'OPEN',
        officerCanView: true,
        deadline: new Date(Date.now() + 86400000),
        targets: { create: { userId: user.id } },
        fields: { create: { label: '测试题目', type: 'TEXT', position: 0 } },
      },
      include: { fields: true },
    });
    taskId = task.id;
    await t.test('初始密码会话和刷新页面均不能跳过改密读取任务、统计、答案或导出', async () => {
      const bootstrap: Bootstrap = await (await request('bootstrap', cookie)).json();
      assert.equal(bootstrap.user.mustChangePassword, true);
      assert.equal(bootstrap.tasks.length, 0);
      assert.equal(bootstrap.officerTasks.length, 0);
      assert.equal(bootstrap.students.length, 0);
      assert.equal(bootstrap.grades.length, 0);
      for (const path of [`tasks/${taskId}`, `tasks/${taskId}/report`, `tasks/${taskId}/export`])
        assert.equal((await request(path, cookie)).status, 403);
      assert.equal(
        (await request(`tasks/${taskId}/submit`, cookie, { [task.fields[0].id]: '绕过尝试' }))
          .status,
        403,
      );
      assert.equal(
        (
          await request(`students/${user.id}/identity`, cookie, {
            isClassOfficer: true,
            fromClassId: cls.id,
          })
        ).status,
        403,
      );
    });
    const change = { password: 'MyOwn2026!Pass', confirmPassword: 'MyOwn2026!Pass' };
    await t.test('拒绝弱密码、两次不一致、伪造他人ID、未登录与跨站改密', async () => {
      for (const body of [
        { password: '123456', confirmPassword: '123456' },
        { password: '12345678', confirmPassword: '12345678' },
        { ...change, confirmPassword: 'Different2026!' },
        { ...change, userId: home.user.id },
        { password: '汉'.repeat(30) + 'A1', confirmPassword: '汉'.repeat(30) + 'A1' },
      ])
        assert.equal((await request('account/initial-password', cookie, body)).status, 400);
      assert.equal((await request('account/initial-password', '', change)).status, 401);
      assert.equal(
        (await request('account/initial-password', cookie, change, 'https://evil.example')).status,
        403,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: user.id } })).mustChangePassword,
        true,
      );
    });
    let active = '';
    await t.test('成功改密后轮换Session，并发旧密码登录和全部原会话均失效', async () => {
      const racing = [login(), login(), login()];
      const response = await request('account/initial-password', cookie, change);
      assert.equal(response.status, 200);
      active = cookieOf(response);
      assert.notEqual(active, cookie);
      for (const old of [cookie, secondCookie])
        assert.equal((await request('bootstrap', old)).status, 401);
      for (const result of await Promise.all(racing)) {
        assert.ok([200, 401].includes(result.status));
        if (result.status === 200)
          assert.equal((await request('bootstrap', cookieOf(result))).status, 401);
      }
      const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(stored.mustChangePassword, false);
      assert.ok(await compare(change.password, stored.passwordHash));
      assert.ok(!(await compare('123456', stored.passwordHash)));
      const ready: Bootstrap = await (await request('bootstrap', active)).json();
      assert.equal(ready.user.mustChangePassword, false);
      assert.ok(ready.tasks.some((t) => t.id === taskId));
      assert.equal((await request(`tasks/${taskId}/report`, active)).status, 200);
    });
    await t.test('以后只能使用新密码，不能再次调用首次改密覆盖密码', async () => {
      assert.equal((await login()).status, 401);
      const valid = await request('login', '', {
        username: user.username,
        password: change.password,
      });
      assert.equal(valid.status, 200);
      assert.equal((await valid.clone().json()).mustChangePassword, false);
      assert.equal(
        (
          await request('account/initial-password', active, {
            password: 'Overwrite2026!',
            confirmPassword: 'Overwrite2026!',
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request('account/initial-password', secondCookie, {
            password: 'Overwrite2026!',
            confirmPassword: 'Overwrite2026!',
          })
        ).status,
        401,
      );
    });
    await t.test('未完成改密可退出，重新登录仍必须先设置密码', async () => {
      const created = await request('students', teacher, {
        name: '虚构未改密同学',
        studentNumber: `second_${tag}`,
        classId: cls.id,
        isClassOfficer: false,
      });
      assert.equal(created.status, 200);
      const other: Person = await created.json();
      ids.push(other.id);
      const auth = await request('login', '', { username: other.username, password: '123456' });
      assert.equal(auth.status, 200);
      const old = cookieOf(auth);
      assert.equal((await request('logout', old, {})).status, 200);
      assert.equal((await request('bootstrap', old)).status, 401);
      const again = await request('login', '', { username: other.username, password: '123456' });
      assert.equal(again.status, 200);
      const bootstrap: Bootstrap = await (await request('bootstrap', cookieOf(again))).json();
      assert.equal(bootstrap.user.mustChangePassword, true);
    });
  } finally {
    if (taskId) {
      await db.submission.deleteMany({ where: { taskId } });
      await db.collectionTask.deleteMany({ where: { id: taskId } });
    }
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
