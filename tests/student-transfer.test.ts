import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import ExcelJS from 'exceljs';
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
  const response = await request('login', '', { username, password });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie')!.split(';')[0];
}
test('学生转班：权限、历史记录和旧 Session 的即时班级隔离', async (t) => {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
    '只允许本机测试，不经公网发送凭据',
  );
  let userId = '';
  let extraGradeId = '';
  let extraClassId = '';
  const taskIds: string[] = [];
  try {
    const teacher = await login('teacher001'),
      sourceMonitor = await login('monitor001'),
      targetMonitor = await login('monitor002'),
      ordinary = await login('student001');
    const home: Bootstrap = await (await request('bootstrap', teacher)).json();
    const source = home.students.find((s) => s.username === 'monitor001')!,
      target = home.students.find((s) => s.username === 'monitor002')!;
    const tag = randomUUID().replaceAll('-', '');
    const password = 'TransferTest2026!';
    const original = await db.user.create({
      data: {
        username: `transfer_${tag}`,
        studentNumber: `transfer_${tag}`,
        name: '虚构转班测试同学',
        classId: source.classId,
        isClassOfficer: true,
        passwordHash: await hash(password, 12),
      },
    });
    userId = original.id;
    const studentCookie = await login(original.username, password);
    const task = await db.collectionTask.create({
      data: {
        title: '转班历史提交测试',
        description: '独立测试',
        gradeId: source.class!.gradeId,
        creatorId: home.user.id,
        status: 'OPEN',
        deadline: new Date(Date.now() + 86400000),
        officerCanView: true,
        targets: { create: [{ userId }, { userId: source.id }, { userId: target.id }] },
        fields: { create: { label: '测试题目', type: 'TEXT', position: 0 } },
      },
      include: { fields: true },
    });
    taskIds.push(task.id);
    const submission = await db.submission.create({
      data: {
        taskId: task.id,
        userId,
        answers: { create: { fieldId: task.fields[0].id, value: '"保留的答案"' } },
      },
    });
    const payload = { classId: target.classId, fromClassId: source.classId, isClassOfficer: false };
    await t.test('未登录、学生和班干部不能转班，跨站请求也被拒绝', async () => {
      for (const [cookie, status] of [
        ['', 401],
        [ordinary, 403],
        [sourceMonitor, 403],
        [studentCookie, 403],
      ] as const)
        assert.equal(
          (await request(`students/${userId}/transfer`, cookie, payload)).status,
          status,
        );
      assert.equal(
        (await request(`students/${userId}/transfer`, teacher, payload, 'https://evil.example'))
          .status,
        403,
      );
    });
    await t.test('拒绝教师对象、无效班级、同班、过期班级信息和额外提权字段', async () => {
      assert.equal(
        (await request(`students/${home.user.id}/transfer`, teacher, payload)).status,
        403,
      );
      assert.equal((await request('students/not-found/transfer', teacher, payload)).status, 404);
      for (const [body, status] of [
        [{ ...payload, classId: 'not-found' }, 400],
        [{ ...payload, classId: source.classId }, 400],
        [{ ...payload, fromClassId: 'stale' }, 409],
        [{ ...payload, role: 'TEACHER' }, 400],
        [{}, 400],
      ] as const)
        assert.equal((await request(`students/${userId}/transfer`, teacher, body)).status, status);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: userId } })).classId,
        source.classId,
      );
    });
    await t.test('教师可转班，账号密码、学号、任务目标、答案和已有登录均保留', async () => {
      const response = await request(`students/${userId}/transfer`, teacher, payload);
      assert.equal(response.status, 200);
      const updated: Person = await response.json();
      assert.equal(updated.classId, target.classId);
      assert.equal(updated.isClassOfficer, false);
      assert.ok(!JSON.stringify(updated).includes('password'));
      const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
      assert.equal(stored.username, original.username);
      assert.equal(stored.studentNumber, original.studentNumber);
      assert.equal(stored.passwordHash, original.passwordHash);
      assert.ok(await db.submission.findUnique({ where: { id: submission.id } }));
      assert.equal(await db.submissionAnswer.count({ where: { submissionId: submission.id } }), 1);
      assert.equal(await db.taskTarget.count({ where: { taskId: task.id, userId } }), 1);
      const own: Bootstrap = await (await request('bootstrap', studentCookie)).json();
      assert.equal(own.user.classId, target.classId);
      assert.ok(own.tasks.some((t) => t.id === task.id));
      assert.equal((await request(`tasks/${task.id}/report`, studentCookie)).status, 403);
    });
    await t.test('旧班干部看不到转出学生，新班统计与 Excel 包含转入学生', async () => {
      for (const [cookie, shouldContain] of [
        [sourceMonitor, false],
        [targetMonitor, true],
      ] as const) {
        const report: Report = await (await request(`tasks/${task.id}/report`, cookie)).json();
        assert.equal(
          report.rows.some((row) => row.id === userId),
          shouldContain,
        );
        const file = await request(`tasks/${task.id}/export`, cookie);
        assert.equal(file.status, 200);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
        let found = false;
        book.worksheets[0].eachRow((row) => {
          if (row.getCell(2).text === original.studentNumber) found = true;
        });
        assert.equal(found, shouldContain);
      }
      const report: Report = await (await request(`tasks/${task.id}/report`, teacher)).json();
      assert.equal(report.total, 3);
      assert.equal(report.submitted, 1);
    });
    await t.test('教师显式设为班干部后，旧 Cookie 只获得当前班的权限', async () => {
      assert.equal(
        (
          await request(`students/${userId}/transfer`, teacher, {
            classId: source.classId,
            fromClassId: target.classId,
            isClassOfficer: true,
          })
        ).status,
        200,
      );
      const report: Report = await (await request(`tasks/${task.id}/report`, studentCookie)).json();
      assert.ok(report.rows.every((row) => row.classId === source.classId));
      assert.equal(
        (await request(`tasks/${task.id}/report?classId=${target.classId}`, studentCookie)).status,
        403,
      );
      assert.equal(
        (await request(`tasks/${task.id}/export?classId=${target.classId}`, studentCookie)).status,
        403,
      );
    });
    await t.test('允许跨年级转班，保留原任务且不自动加入新年级历史任务', async () => {
      const grade = await db.grade.create({ data: { name: '虚构转班测试年级' } });
      extraGradeId = grade.id;
      const cls = await db.class.create({ data: { name: '虚构转班目标班级', gradeId: grade.id } });
      extraClassId = cls.id;
      const unrelated = await db.collectionTask.create({
        data: {
          title: '新年级历史任务',
          description: '测试',
          gradeId: grade.id,
          creatorId: home.user.id,
          status: 'OPEN',
          deadline: new Date(Date.now() + 86400000),
        },
      });
      taskIds.push(unrelated.id);
      assert.equal(
        (
          await request(`students/${userId}/transfer`, teacher, {
            classId: cls.id,
            fromClassId: source.classId,
            isClassOfficer: false,
          })
        ).status,
        200,
      );
      const own: Bootstrap = await (await request('bootstrap', studentCookie)).json();
      assert.equal(own.user.class?.gradeId, grade.id);
      assert.ok(own.tasks.some((t) => t.id === task.id));
      assert.ok(!own.tasks.some((t) => t.id === unrelated.id));
      const answer = await (await request(`tasks/${task.id}`, studentCookie)).json();
      assert.equal(answer.submission.id, submission.id);
      assert.equal((await request(`tasks/${unrelated.id}`, studentCookie)).status, 403);
    });
  } finally {
    await db.submission.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.collectionTask.deleteMany({ where: { id: { in: taskIds } } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    if (extraClassId) await db.class.deleteMany({ where: { id: extraClassId } });
    if (extraGradeId) await db.grade.deleteMany({ where: { id: extraGradeId } });
    await db.$disconnect();
  }
});
