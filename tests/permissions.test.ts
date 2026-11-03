import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { Bootstrap, Report, Task, Submission } from '../src/lib/types';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const db = new PrismaClient();
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
test('完整收集流程与服务端权限边界（真实 HTTP + SQLite）', async (t) => {
  const taskIds: string[] = [];
  try {
    await t.test('未登录不能读取数据', async () =>
      assert.equal((await request('bootstrap')).status, 401),
    );
    await t.test('登录拒绝错误密码及跨站写入', async () => {
      assert.equal(
        (await request('login', '', { username: 'teacher001', password: 'wrong' })).status,
        401,
      );
      assert.equal(
        (
          await request(
            'login',
            '',
            { username: 'teacher001', password: 'Demo2026!' },
            'https://evil.example',
          )
        ).status,
        403,
      );
    });
    const teacher = await login('teacher001'),
      student = await login('student001'),
      monitor = await login('monitor001'),
      monitor2 = await login('monitor002');
    const admin: Bootstrap = await (await request('bootstrap', teacher)).json();
    const own: Bootstrap = await (await request('bootstrap', student)).json();
    const mon: Bootstrap = await (await request('bootstrap', monitor)).json();
    const mon2: Bootstrap = await (await request('bootstrap', monitor2)).json();
    const gradeId = admin.grades[0].id;
    const draftInput = {
      title: '权限集成测试（结束后自动删除）',
      description: '虚构测试数据',
      gradeId,
      deadline: new Date(Date.now() + 86400000).toISOString(),
      allowEdit: true,
      officerCanView: false,
      fields: [
        { label: '文本', type: 'TEXT', required: true, options: [] },
        { label: '数字', type: 'NUMBER', required: true, options: [] },
        { label: '选择', type: 'RADIO', required: true, options: ['甲', '乙'] },
        { label: '多选', type: 'CHECKBOX', required: true, options: ['一', '二'] },
        { label: '日期', type: 'DATE', required: true, options: [] },
        { label: '是否', type: 'BOOLEAN', required: true, options: [] },
        { label: '说明', type: 'TEXTAREA', required: false, options: [] },
      ],
    };
    await t.test('学生拿不到学生名册、草稿、密码和其他提交', async () => {
      assert.equal(own.students.length, 0);
      assert.equal(own.grades.length, 0);
      assert.ok(own.tasks.every((task) => task.status !== 'DRAFT'));
      assert.ok(!JSON.stringify(own).includes('passwordHash'));
      assert.equal((await request('tasks', student, draftInput)).status, 403);
      assert.equal(
        (await request(`tasks/${admin.tasks.find((t) => t.status === 'DRAFT')!.id}`, student))
          .status,
        403,
      );
    });
    const created = await request('tasks', teacher, draftInput);
    assert.equal(created.status, 200);
    const { id } = await created.json();
    taskIds.push(id);
    await t.test('草稿不允许学生访问', async () =>
      assert.equal((await request(`tasks/${id}`, student)).status, 403),
    );
    assert.equal((await request(`tasks/${id}/status`, teacher, { status: 'OPEN' })).status, 200);
    const detail: { task: Task; submission: Submission | null } = await (
      await request(`tasks/${id}`, student)
    ).json();
    const fields = detail.task.fields!;
    const answers = Object.fromEntries(
      fields.map((f, i) => [
        f.id,
        ['文本测试', '12', '甲', ['一'], '2026-11-20', '否', '测试说明'][i],
      ]),
    );
    await t.test('拒绝缺少必填、伪造字段、非法选项和无效日期', async () => {
      for (const body of [
        {},
        { ...answers, unknown: '伪造' },
        { ...answers, [fields[2].id]: '丙' },
        { ...answers, [fields[3].id]: ['一', '非法'] },
        { ...answers, [fields[4].id]: '2026-02-30' },
        { ...answers, [fields[1].id]: 'Infinity' },
      ])
        assert.equal((await request(`tasks/${id}/submit`, student, body)).status, 400);
    });
    await t.test('可提交、修改且一个学生只有一份提交', async () => {
      assert.equal((await request(`tasks/${id}/submit`, student, answers)).status, 200);
      assert.equal(
        (await request(`tasks/${id}/submit`, student, { ...answers, [fields[0].id]: '修改后' }))
          .status,
        200,
      );
      assert.equal(await db.submission.count({ where: { taskId: id, userId: own.user.id } }), 1);
      const another = await (await request(`tasks/${id}?userId=${own.user.id}`, monitor)).json();
      assert.equal(another.submission, null);
    });
    await t.test('普通学生不能统计、导出或冒充指定其他学生提交', async () => {
      assert.equal((await request(`tasks/${id}/report`, student)).status, 403);
      assert.equal((await request(`tasks/${id}/export`, student)).status, 403);
      assert.equal(
        (await request(`tasks/${id}/submit`, student, { ...answers, userId: mon2.user.id })).status,
        400,
      );
    });
    await t.test('班干部仅本班统计，默认不返回答案', async () => {
      const report: Report = await (await request(`tasks/${id}/report`, monitor)).json();
      assert.equal(report.total, 10);
      assert.equal(report.submitted, 1);
      assert.ok(report.rows.every((r) => r.classId === mon.user.classId));
      assert.ok(report.rows.every((r) => !r.submission?.answers));
      assert.equal(
        (await request(`tasks/${id}/report?classId=${mon2.user.classId}`, monitor)).status,
        403,
      );
      assert.equal(
        (await request(`tasks/${id}/export?classId=${mon2.user.classId}`, monitor)).status,
        403,
      );
    });
    await t.test('Excel 教师40行数据，班干部10行且无答案列', async () => {
      for (const [cookie, rows, cols] of [
        [teacher, 41, 11],
        [monitor, 11, 4],
      ] as const) {
        const response = await request(`tasks/${id}/export`, cookie);
        assert.equal(response.status, 200);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
        assert.equal(book.worksheets[0].rowCount, rows);
        assert.equal(book.worksheets[0].columnCount, cols);
      }
    });
    await db.collectionTask.update({ where: { id }, data: { officerCanView: true } });
    await t.test('显式授权后班干部可查看本班答案', async () => {
      const report: Report = await (await request(`tasks/${id}/report`, monitor)).json();
      assert.ok(report.canView);
      assert.equal(report.rows.find((r) => r.id === own.user.id)?.submission?.answers?.length, 7);
    });
    await db.collectionTask.update({ where: { id }, data: { allowEdit: false } });
    await t.test('关闭修改权限后不能重复填写', async () =>
      assert.equal((await request(`tasks/${id}/submit`, student, answers)).status, 403),
    );
    await db.collectionTask.update({
      where: { id },
      data: { allowEdit: true, deadline: new Date(Date.now() - 1000) },
    });
    await t.test('自动截止后不能提交', async () =>
      assert.equal((await request(`tasks/${id}/submit`, student, answers)).status, 400),
    );
    await request(`tasks/${id}/deadline`, teacher, {
      deadline: new Date(Date.now() + 86400000).toISOString(),
    });
    await request(`tasks/${id}/status`, teacher, { status: 'CLOSED' });
    await t.test('手动结束不能提交或重新发布', async () => {
      assert.equal((await request(`tasks/${id}/submit`, student, answers)).status, 400);
      assert.equal((await request(`tasks/${id}/status`, teacher, { status: 'OPEN' })).status, 400);
    });
    const targeted = await request('tasks', teacher, { ...draftInput, targetIds: [own.user.id] });
    const targetedId = (await targeted.json()).id;
    taskIds.push(targetedId);
    await request(`tasks/${targetedId}/status`, teacher, { status: 'OPEN' });
    await t.test('指定学生的任务不能被其他学生访问', async () => {
      assert.equal((await request(`tasks/${targetedId}`, monitor)).status, 403);
      assert.equal((await request(`tasks/${targetedId}/report`, monitor2)).status, 403);
      const report: Report = await (await request(`tasks/${targetedId}/report`, teacher)).json();
      assert.equal(report.total, 1);
      const officerHome: Bootstrap = await (await request('bootstrap', monitor)).json();
      assert.ok(officerHome.officerTasks.some((task) => task.id === targetedId));
      assert.ok(!officerHome.tasks.some((task) => task.id === targetedId));
    });
    await t.test('退出后 Session 立即失效', async () => {
      await request('logout', student, {});
      assert.equal((await request('bootstrap', student)).status, 401);
    });
  } finally {
    await db.submission.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.collectionTask.deleteMany({ where: { id: { in: taskIds } } });
    await db.$disconnect();
  }
});
