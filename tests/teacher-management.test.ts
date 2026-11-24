import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hash, compare } from 'bcryptjs';
import { tokenHash } from '../src/lib/auth';

const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
async function request(path: string, cookie = '', body?: unknown, origin = base) {
  return fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('超级管理员管理教师：权限、初始密码、删除撤权与历史数据保留', async (t) => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
  const ids: string[] = [];
  let gradeId = '';
  let taskId = '';
  const tag = randomBytes(8).toString('hex');
  const passwordHash = await hash('TestTeacher2026!', 12);
  async function actor(role: string, isSuperAdmin = false) {
    const user = await db.user.create({
      data: {
        username: `${tag}_${ids.length}`,
        name: '临时权限测试',
        role,
        isSuperAdmin,
        passwordHash,
      },
    });
    ids.push(user.id);
    const token = randomBytes(32).toString('hex');
    await db.session.create({
      data: { id: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + 3600000) },
    });
    return { user, cookie: `grade_session=${token}` };
  }
  try {
    const admin = await actor('TEACHER', true);
    const teacher = await actor('TEACHER');
    const student = await actor('STUDENT');
    const otherAdmin = await actor('TEACHER', true);
    const payload = { name: '临时新教师', username: `teacher_${tag}` };
    await t.test('未登录、普通教师和学生不能查询、创建或删除教师；拒绝跨站写入', async () => {
      for (const [cookie, status] of [
        ['', 401],
        [teacher.cookie, 403],
        [student.cookie, 403],
      ] as const) {
        assert.equal((await request('teachers', cookie)).status, status);
        assert.equal((await request('teachers', cookie, payload)).status, status);
        assert.equal(
          (
            await request(`teachers/${teacher.user.id}/delete`, cookie, {
              confirmUsername: teacher.user.username,
            })
          ).status,
          status,
        );
      }
      assert.equal(
        (await request('teachers', admin.cookie, payload, 'https://evil.example')).status,
        403,
      );
      assert.equal(
        (
          await request(
            `teachers/${teacher.user.id}/delete`,
            admin.cookie,
            { confirmUsername: teacher.user.username },
            'https://evil.example',
          )
        ).status,
        403,
      );
    });
    let created: { teacher: { id: string }; initialPassword: string };
    await t.test('参数校验、拒绝提权、统一初始密码123456、不泄露密码哈希', async () => {
      for (const body of [
        { ...payload, isSuperAdmin: true },
        { ...payload, role: 'TEACHER' },
        { ...payload, username: '含空格 bad' },
        { ...payload, name: '' },
      ])
        assert.equal((await request('teachers', admin.cookie, body)).status, 400);
      const response = await request('teachers', admin.cookie, payload);
      assert.equal(response.status, 200);
      created = await response.json();
      assert.equal(created.initialPassword, '123456');
      ids.push(created.teacher.id);
      const saved = await db.user.findUniqueOrThrow({ where: { id: created.teacher.id } });
      assert.equal(saved.role, 'TEACHER');
      assert.equal(saved.isSuperAdmin, false);
      assert.equal(saved.mustChangePassword, true);
      assert.ok(await compare(created.initialPassword, saved.passwordHash));
      assert.ok(!JSON.stringify(created).includes('passwordHash'));
      assert.equal((await request('teachers', admin.cookie, payload)).status, 409);
      assert.equal(
        (await request('teachers', admin.cookie, { ...payload, username: student.user.username }))
          .status,
        409,
      );
      const list = await (await request('teachers', admin.cookie)).json();
      assert.ok(list.some((u: { id: string }) => u.id === created.teacher.id));
      assert.ok(!JSON.stringify(list).includes('passwordHash'));
      assert.ok(!JSON.stringify(list).includes(created.initialPassword));
    });
    let cookie = '';
    await t.test('新教师首次登录只能改密，改密后有教师权限但无管理教师权限', async () => {
      const login = await request('login', '', {
        username: payload.username,
        password: created.initialPassword,
      });
      assert.equal(login.status, 200);
      cookie = login.headers.get('set-cookie')!.split(';')[0];
      const home = await (await request('bootstrap', cookie)).json();
      assert.equal(home.user.mustChangePassword, true);
      assert.deepEqual(home.tasks, []);
      assert.equal((await request('teachers', cookie)).status, 403);
      assert.equal((await request('tasks', cookie, {})).status, 403);
      const changed = await request('account/initial-password', cookie, {
        password: 'NewTeacher2026!',
        confirmPassword: 'NewTeacher2026!',
      });
      assert.equal(changed.status, 200);
      assert.equal((await request('bootstrap', cookie)).status, 401);
      cookie = changed.headers.get('set-cookie')!.split(';')[0];
      const updated = await (await request('bootstrap', cookie)).json();
      assert.equal(updated.user.role, 'TEACHER');
      assert.equal(updated.user.mustChangePassword, false);
      assert.equal((await request('teachers', cookie, payload)).status, 403);
      assert.equal(
        (
          await request('login', '', {
            username: payload.username,
            password: created.initialPassword,
          })
        ).status,
        401,
      );
    });
    await t.test('不能删除自己、其他超级管理员、学生；确认错误不删除', async () => {
      for (const user of [admin.user, otherAdmin.user, student.user])
        assert.equal(
          (
            await request(`teachers/${user.id}/delete`, admin.cookie, {
              confirmUsername: user.username,
            })
          ).status,
          403,
        );
      assert.equal(
        (
          await request(`teachers/${created.teacher.id}/delete`, admin.cookie, {
            confirmUsername: 'wrong',
          })
        ).status,
        400,
      );
      assert.ok(await db.user.findUnique({ where: { id: created.teacher.id } }));
    });
    await t.test('删除教师撤销原会话、保留任务和学生提交，并移交任务创建人', async () => {
      const grade = await db.grade.create({ data: { name: `权限测试_${tag}` } });
      gradeId = grade.id;
      const task = await db.collectionTask.create({
        data: {
          title: '教师删除保留测试',
          description: '',
          gradeId,
          creatorId: created.teacher.id,
          deadline: new Date(Date.now() + 86400000),
          targets: { create: { userId: student.user.id } },
          fields: { create: { label: '保留字段', type: 'TEXT', position: 0 } },
        },
        include: { fields: true },
      });
      taskId = task.id;
      const submission = await db.submission.create({
        data: {
          taskId,
          userId: student.user.id,
          answers: { create: { fieldId: task.fields[0].id, value: '"历史答案"' } },
        },
      });
      assert.equal(
        (
          await request(`teachers/${created.teacher.id}/delete`, admin.cookie, {
            confirmUsername: payload.username,
          })
        ).status,
        200,
      );
      assert.equal(await db.user.findUnique({ where: { id: created.teacher.id } }), null);
      assert.equal((await request('bootstrap', cookie)).status, 401);
      assert.equal(
        (await db.collectionTask.findUniqueOrThrow({ where: { id: taskId } })).creatorId,
        admin.user.id,
      );
      assert.equal(await db.submissionAnswer.count({ where: { submissionId: submission.id } }), 1);
      assert.ok(await db.user.findUnique({ where: { id: student.user.id } }));
      assert.equal(
        (
          await request(`teachers/${created.teacher.id}/delete`, admin.cookie, {
            confirmUsername: payload.username,
          })
        ).status,
        404,
      );
    });
  } finally {
    if (taskId) {
      await db.submission.deleteMany({ where: { taskId } });
      await db.collectionTask.deleteMany({ where: { id: taskId } });
    }
    if (gradeId) await db.grade.deleteMany({ where: { id: gradeId } });
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
