import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import type { Bootstrap } from '../src/lib/types';
const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const passwords: Record<string, string> = process.env.TEST_ACCOUNTS_FILE
  ? JSON.parse(readFileSync(process.env.TEST_ACCOUNTS_FILE, 'utf8'))
  : {};
async function request(path: string, cookie = '', body?: unknown, origin = base) {
  return fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(username: string) {
  const response = await request('login', '', {
    username,
    password: passwords[username] || 'Demo2026!',
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie')!.split(';')[0];
}
test('教师删除任务：权限、完整清理和所有任务状态', async (t) => {
  assert.ok(
    ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
    '删除测试仅允许本机独立测试库',
  );
  const ids: string[] = [];
  try {
    const teacher = await login('teacher001');
    const student = await login('student001');
    const monitor = await login('monitor001');
    const home: Bootstrap = await (await request('bootstrap', teacher)).json();
    for (const status of ['DRAFT', 'OPEN', 'CLOSED']) {
      const task = await db.collectionTask.create({
        data: {
          title: `任务删除测试-${status}`,
          description: '独立测试',
          status,
          gradeId: home.grades[0].id,
          creatorId: home.user.id,
          deadline: new Date(Date.now() + 86400000),
          targets: { create: { userId: home.students[0].id } },
          fields: { create: { label: '测试题目', type: 'TEXT', position: 0 } },
        },
        include: { fields: true },
      });
      ids.push(task.id);
    }
    const task = await db.collectionTask.findUniqueOrThrow({
      where: { id: ids[1] },
      include: { fields: true },
    });
    await db.submission.create({
      data: {
        taskId: task.id,
        userId: home.students[0].id,
        answers: { create: { fieldId: task.fields[0].id, value: '"测试答案"' } },
      },
    });
    const payload = { confirmTitle: task.title };
    await t.test('未登录、学生和班干部均无法删除，教师不能绕过同源校验', async () => {
      for (const [cookie, expected] of [
        ['', 401],
        [student, 403],
        [monitor, 403],
      ] as const)
        assert.equal((await request(`tasks/${task.id}/delete`, cookie, payload)).status, expected);
      assert.equal(
        (await request(`tasks/${task.id}/delete`, teacher, payload, 'https://evil.example')).status,
        403,
      );
      assert.equal(await db.collectionTask.count({ where: { id: task.id } }), 1);
    });
    await t.test('必须确认正确名称，错误输入不会删除已有答案', async () => {
      for (const body of [{}, { confirmTitle: '错误名称' }, { ...payload, force: true }])
        assert.equal((await request(`tasks/${task.id}/delete`, teacher, body)).status, 400);
      assert.equal(await db.submission.count({ where: { taskId: task.id } }), 1);
      assert.equal(await db.submissionAnswer.count({ where: { fieldId: task.fields[0].id } }), 1);
    });
    await t.test('教师可删除有提交的收集中任务，原子清理字段/名单/提交/答案', async () => {
      assert.equal((await request(`tasks/${task.id}/delete`, teacher, payload)).status, 200);
      assert.equal(await db.collectionTask.count({ where: { id: task.id } }), 0);
      assert.equal(await db.formField.count({ where: { taskId: task.id } }), 0);
      assert.equal(await db.taskTarget.count({ where: { taskId: task.id } }), 0);
      assert.equal(await db.submission.count({ where: { taskId: task.id } }), 0);
      assert.equal(await db.submissionAnswer.count({ where: { fieldId: task.fields[0].id } }), 0);
      assert.ok(await db.user.findUnique({ where: { id: home.students[0].id } }));
      assert.equal(await db.collectionTask.count({ where: { id: { in: [ids[0], ids[2]] } } }), 2);
    });
    await t.test('删除后详情、统计、导出和再次删除都返回404，列表不再显示', async () => {
      for (const path of [`tasks/${task.id}`, `tasks/${task.id}/report`, `tasks/${task.id}/export`])
        assert.equal((await request(path, teacher)).status, 404);
      assert.equal((await request(`tasks/${task.id}/delete`, teacher, payload)).status, 404);
      const updated: Bootstrap = await (await request('bootstrap', teacher)).json();
      assert.ok(!updated.tasks.some((t) => t.id === task.id));
    });
    await t.test('草稿和手动截止任务也可以删除', async () => {
      for (const id of [ids[0], ids[2]]) {
        const item = await db.collectionTask.findUniqueOrThrow({ where: { id } });
        assert.equal(
          (await request(`tasks/${id}/delete`, teacher, { confirmTitle: item.title })).status,
          200,
        );
      }
    });
  } finally {
    await db.submission.deleteMany({ where: { taskId: { in: ids } } });
    await db.collectionTask.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
