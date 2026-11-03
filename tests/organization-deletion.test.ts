import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Bootstrap } from '../src/lib/types';

const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
async function request(path: string, cookie = '', body?: unknown, origin = base) {
  return fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(username: string) {
  const response = await request('login', '', { username, password: 'Demo2026!' });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie')!.split(';')[0];
}

test('教师删除年级和班级：后端权限、确认名称、关联保护及删除后刷新', async (t) => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), '仅对本机独立测试库运行');
  const tag = randomUUID();
  const gradeIds: string[] = [],
    classIds: string[] = [],
    taskIds: string[] = [],
    userIds: string[] = [];
  try {
    const teacher = await login('teacher001');
    const student = await login('student001');
    const monitor = await login('monitor001');
    const teacherUser = await db.user.findUniqueOrThrow({ where: { username: 'teacher001' } });
    const grade = await db.grade.create({ data: { name: `删除测试年级_${tag}` } });
    gradeIds.push(grade.id);
    const otherGrade = await db.grade.create({ data: { name: `保留测试年级_${tag}` } });
    gradeIds.push(otherGrade.id);
    const cls = await db.class.create({ data: { name: '同名测试班', gradeId: grade.id } });
    classIds.push(cls.id);
    const otherClass = await db.class.create({ data: { name: cls.name, gradeId: otherGrade.id } });
    classIds.push(otherClass.id);
    const person = await db.user.create({
      data: {
        username: `delete_org_${tag}`,
        name: '虚构删除测试同学',
        role: 'STUDENT',
        passwordHash: teacherUser.passwordHash,
        classId: cls.id,
      },
    });
    userIds.push(person.id);
    for (const status of ['DRAFT', 'OPEN', 'CLOSED']) {
      const task = await db.collectionTask.create({
        data: {
          title: `删除组织测试_${status}`,
          description: '虚构测试',
          status,
          gradeId: grade.id,
          creatorId: teacherUser.id,
          deadline: new Date(Date.now() + 86400000),
          targets: { create: { userId: person.id } },
          fields: { create: { label: '测试字段', type: 'TEXT', required: false, position: 0 } },
        },
        include: { fields: true },
      });
      taskIds.push(task.id);
      if (status === 'OPEN')
        await db.submission.create({
          data: {
            taskId: task.id,
            userId: person.id,
            answers: { create: { fieldId: task.fields[0].id, value: JSON.stringify('保留答案') } },
          },
        });
    }
    const classPath = `classes/${cls.id}/delete`,
      gradePath = `grades/${grade.id}/delete`;
    await t.test('未登录、学生、班干部和跨站请求不能删除', async () => {
      for (const [path, confirmName] of [
        [classPath, cls.name],
        [gradePath, grade.name],
      ]) {
        for (const [cookie, status] of [
          ['', 401],
          [student, 403],
          [monitor, 403],
        ] as const)
          assert.equal((await request(path, cookie, { confirmName })).status, status);
        assert.equal(
          (await request(path, teacher, { confirmName }, 'https://evil.example')).status,
          403,
        );
      }
    });
    await t.test('名称必须完整匹配，拒绝额外字段与不存在的ID', async () => {
      for (const [path, confirmName] of [
        [classPath, cls.name],
        [gradePath, grade.name],
      ]) {
        for (const body of [
          {},
          { confirmName: '不匹配' },
          { confirmName: ` ${confirmName} ` },
          { confirmName, force: true },
        ])
          assert.equal((await request(path, teacher, body)).status, 400);
      }
      for (const kind of ['classes', 'grades'])
        assert.equal(
          (await request(`${kind}/missing/delete`, teacher, { confirmName: '不存在' })).status,
          404,
        );
    });
    await t.test('有学生的班级不能删除，账号、答案和任务范围不变', async () => {
      const response = await request(classPath, teacher, { confirmName: cls.name });
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /转班/);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: person.id } })).classId, cls.id);
      assert.equal(await db.submission.count({ where: { userId: person.id } }), 1);
      assert.equal(
        await db.submissionAnswer.count({ where: { submission: { userId: person.id } } }),
        1,
      );
      assert.equal(await db.taskTarget.count({ where: { userId: person.id } }), 3);
    });
    await t.test('存在班级的年级不能删除，即使班级为空', async () => {
      assert.equal((await request(gradePath, teacher, { confirmName: grade.name })).status, 409);
      // 第二个年级没有任务，单独验证空班级也会阻止删除年级。
      assert.equal(
        (await request(`grades/${otherGrade.id}/delete`, teacher, { confirmName: otherGrade.name }))
          .status,
        409,
      );
      assert.ok(await db.class.findUnique({ where: { id: otherClass.id } }));
    });
    await t.test('转班后可删除空班级，同名的其他班级与历史提交保留', async () => {
      const transfer = await request(`students/${person.id}/transfer`, teacher, {
        classId: otherClass.id,
        fromClassId: cls.id,
        isClassOfficer: false,
      });
      assert.equal(transfer.status, 200);
      assert.equal((await request(classPath, teacher, { confirmName: cls.name })).status, 200);
      assert.equal((await request(classPath, teacher, { confirmName: cls.name })).status, 404);
      assert.equal(await db.class.findUnique({ where: { id: cls.id } }), null);
      assert.ok(await db.class.findUnique({ where: { id: otherClass.id } }));
      assert.equal(await db.submission.count({ where: { userId: person.id } }), 1);
    });
    await t.test('各状态任务均阻止年级删除，处理所有任务后才能删除空年级', async () => {
      for (const id of taskIds) {
        const response = await request(gradePath, teacher, { confirmName: grade.name });
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /任务/);
        const task = await db.collectionTask.findUniqueOrThrow({ where: { id } });
        assert.equal(
          (await request(`tasks/${id}/delete`, teacher, { confirmTitle: task.title })).status,
          200,
        );
      }
      assert.equal((await request(gradePath, teacher, { confirmName: grade.name })).status, 200);
      assert.equal((await request(gradePath, teacher, { confirmName: grade.name })).status, 404);
    });
    await t.test('删除结果反映到工作台，其他年级与转班后的学生不受影响', async () => {
      const response = await request('bootstrap', teacher);
      assert.equal(response.status, 200);
      const data: Bootstrap = await response.json();
      assert.ok(!data.grades.some((g) => g.id === grade.id));
      assert.equal(data.grades.find((g) => g.id === otherGrade.id)!.classes[0].id, otherClass.id);
      assert.equal(data.students.find((s) => s.id === person.id)!.classId, otherClass.id);
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
