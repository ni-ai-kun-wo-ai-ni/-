import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
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
const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];
async function login(username: string) {
  const r = await request('login', '', { username, password: passwords[username] || 'Demo2026!' });
  assert.equal(r.status, 200);
  return cookieOf(r);
}
test('教师添加年级和班级：权限、唯一名称和学生/转班/任务集成', async (t) => {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
    '只允许本机独立测试，不经公网发送密码',
  );
  const gradeIds: string[] = [],
    classIds: string[] = [],
    userIds: string[] = [],
    taskIds: string[] = [];
  try {
    const teacher = await login('teacher001'),
      student = await login('student001'),
      monitor = await login('monitor001');
    const tag = randomUUID().replaceAll('-', '').slice(0, 16);
    const gradeName = `虚构组织测试年级_${tag}`,
      className = `虚构组织测试班_${tag}`;
    await t.test('未登录、普通学生和班干部不能创建组织，跨站请求被拒绝', async () => {
      for (const path of ['grades', 'classes'])
        for (const [c, status] of [
          ['', 401],
          [student, 403],
          [monitor, 403],
        ] as const)
          assert.equal(
            (await request(path, c, { name: gradeName, gradeId: 'unused' })).status,
            status,
          );
      assert.equal(
        (await request('grades', teacher, { name: gradeName }, 'https://evil.example')).status,
        403,
      );
      assert.equal(
        (
          await request(
            'classes',
            teacher,
            { name: className, gradeId: 'unused' },
            'https://evil.example',
          )
        ).status,
        403,
      );
    });
    await t.test('教师可以添加年级，名称去除两端空白且不能重复', async () => {
      for (const name of [gradeName, `${gradeName}_B`]) {
        const response = await request('grades', teacher, { name: ` ${name} ` });
        assert.equal(response.status, 200);
        const grade = await response.json();
        assert.equal(grade.name, name);
        gradeIds.push(grade.id);
      }
      assert.equal((await request('grades', teacher, { name: ` ${gradeName} ` })).status, 409);
      const bootstrap: Bootstrap = await (await request('bootstrap', teacher)).json();
      const grade = bootstrap.grades.find((g) => g.id === gradeIds[0]);
      assert.ok(grade);
      assert.equal(grade.classes.length, 0);
    });
    await t.test('班级必须关联有效年级，同年级不重名、不同年级可同名', async () => {
      assert.equal(
        (await request('classes', teacher, { name: className, gradeId: 'not-found' })).status,
        400,
      );
      for (const gradeId of gradeIds) {
        const r = await request('classes', teacher, { name: ` ${className} `, gradeId });
        assert.equal(r.status, 200);
        const cls = await r.json();
        assert.equal(cls.gradeId, gradeId);
        assert.equal(cls.name, className);
        classIds.push(cls.id);
      }
      assert.equal(
        (await request('classes', teacher, { name: className, gradeId: gradeIds[0] })).status,
        409,
      );
    });
    await t.test('拒绝空名称、过长名称和伪造ID等额外字段', async () => {
      for (const name of ['', '   ', '字'.repeat(61)]) {
        assert.equal((await request('grades', teacher, { name })).status, 400);
        assert.equal(
          (await request('classes', teacher, { name, gradeId: gradeIds[0] })).status,
          400,
        );
      }
      assert.equal(
        (await request('grades', teacher, { name: '不应被创建', id: 'forged' })).status,
        400,
      );
      assert.equal(
        (
          await request('classes', teacher, {
            name: '不应被创建',
            gradeId: gradeIds[0],
            role: 'TEACHER',
          })
        ).status,
        400,
      );
    });
    let person: Person;
    let studentCookie = '';
    await t.test('新增班级人数从0开始，可创建学生并在新年级发布任务', async () => {
      let bootstrap: Bootstrap = await (await request('bootstrap', teacher)).json();
      assert.equal(
        bootstrap.grades.find((g) => g.id === gradeIds[0])!.classes[0]._count.students,
        0,
      );
      const response = await request('students', teacher, {
        name: '虚构组织测试同学',
        studentNumber: `org_${tag}`,
        classId: classIds[0],
        isClassOfficer: false,
      });
      assert.equal(response.status, 200);
      person = await response.json();
      userIds.push(person.id);
      assert.equal(person.class?.gradeId, gradeIds[0]);
      const initial = await request('login', '', { username: person.username, password: '123456' });
      assert.equal(initial.status, 200);
      const change = await request('account/initial-password', cookieOf(initial), {
        password: 'OrgStudent2026!',
        confirmPassword: 'OrgStudent2026!',
      });
      assert.equal(change.status, 200);
      studentCookie = cookieOf(change);
      const task = await request('tasks', teacher, {
        title: '新年级组织集成测试',
        description: '虚构测试',
        gradeId: gradeIds[0],
        deadline: new Date(Date.now() + 86400000).toISOString(),
        allowEdit: true,
        officerCanView: true,
        fields: [{ label: '测试题目', type: 'TEXT', required: false, options: [] }],
      });
      assert.equal(task.status, 200);
      const { id } = await task.json();
      taskIds.push(id);
      assert.equal((await request(`tasks/${id}/status`, teacher, { status: 'OPEN' })).status, 200);
      const own: Bootstrap = await (await request('bootstrap', studentCookie)).json();
      assert.ok(own.tasks.some((t) => t.id === id));
      bootstrap = await (await request('bootstrap', teacher)).json();
      assert.equal(
        bootstrap.grades.find((g) => g.id === gradeIds[0])!.classes[0]._count.students,
        1,
      );
    });
    await t.test('新建的其他年级班级可作为转班目标，人数和个人班级同步更新', async () => {
      const response = await request(`students/${person.id}/transfer`, teacher, {
        classId: classIds[1],
        fromClassId: classIds[0],
        isClassOfficer: false,
      });
      assert.equal(response.status, 200);
      const updated: Person = await response.json();
      assert.equal(updated.class?.gradeId, gradeIds[1]);
      const bootstrap: Bootstrap = await (await request('bootstrap', teacher)).json();
      assert.equal(
        bootstrap.grades.find((g) => g.id === gradeIds[0])!.classes[0]._count.students,
        0,
      );
      assert.equal(
        bootstrap.grades.find((g) => g.id === gradeIds[1])!.classes[0]._count.students,
        1,
      );
      const own: Bootstrap = await (await request('bootstrap', studentCookie)).json();
      assert.equal(own.user.classId, classIds[1]);
    });
  } finally {
    await db.submission.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.collectionTask.deleteMany({ where: { id: { in: taskIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.class.deleteMany({ where: { id: { in: classIds } } });
    await db.grade.deleteMany({ where: { id: { in: gradeIds } } });
    await db.$disconnect();
  }
});
