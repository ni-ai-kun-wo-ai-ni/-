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
test('修改教师信息：权限、重名冲突、密码重设和超级管理员自改', async (t) => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
  const ids: string[] = [];
  const tag = randomBytes(8).toString('hex');
  const passwordHash = await hash('OldPassword2026!', 12);
  async function actor(role: string, isSuperAdmin = false) {
    const user = await db.user.create({
      data: {
        username: `edit_${tag}_${ids.length}`,
        name: '修改测试',
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
    const admin = await actor('TEACHER', true),
      teacher = await actor('TEACHER'),
      student = await actor('STUDENT'),
      protectedAdmin = await actor('TEACHER', true);
    const path = `teachers/${teacher.user.id}/update`;
    const payload = { name: '新教师姓名', username: teacher.user.username };
    await t.test('拒绝未登录、教师、学生、跨站、伪造权限及非教师对象', async () => {
      for (const [cookie, status] of [
        ['', 401],
        [teacher.cookie, 403],
        [student.cookie, 403],
      ] as const)
        assert.equal((await request(path, cookie, payload)).status, status);
      assert.equal(
        (await request(path, admin.cookie, payload, 'https://evil.example')).status,
        403,
      );
      assert.equal(
        (await request(path, admin.cookie, { ...payload, isSuperAdmin: true })).status,
        400,
      );
      assert.equal(
        (await request(`teachers/${student.user.id}/update`, admin.cookie, payload)).status,
        403,
      );
      assert.equal(
        (await request(`teachers/${protectedAdmin.user.id}/update`, admin.cookie, payload)).status,
        403,
      );
      assert.equal((await request('teachers/missing/update', admin.cookie, payload)).status, 404);
    });
    await t.test('仅改姓名保留密码和会话，重复账号或弱密码不能部分保存', async () => {
      assert.equal((await request(path, admin.cookie, payload)).status, 200);
      const updated = await db.user.findUniqueOrThrow({ where: { id: teacher.user.id } });
      assert.equal(updated.name, payload.name);
      assert.equal(updated.passwordHash, passwordHash);
      assert.equal((await request('bootstrap', teacher.cookie)).status, 200);
      assert.equal(
        (
          await request(path, admin.cookie, {
            ...payload,
            name: '不应保存',
            username: student.user.username,
          })
        ).status,
        409,
      );
      assert.equal(
        (await request(path, admin.cookie, { ...payload, password: '123' })).status,
        400,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: teacher.user.id } })).name,
        payload.name,
      );
    });
    await t.test('修改账号并重设密码撤销旧登录，重新登录后必须改密', async () => {
      const username = `new_${tag}`;
      const r = await request(path, admin.cookie, {
        ...payload,
        username,
        password: 'ResetPassword2026!',
      });
      assert.equal(r.status, 200);
      const result = await r.json();
      assert.equal(result.reauthenticate, false);
      assert.equal(result.teacher.mustChangePassword, true);
      assert.ok(!JSON.stringify(result).includes('passwordHash'));
      assert.equal((await request('bootstrap', teacher.cookie)).status, 401);
      assert.equal(
        (
          await request('login', '', {
            username: teacher.user.username,
            password: 'OldPassword2026!',
          })
        ).status,
        401,
      );
      const login = await request('login', '', { username, password: 'ResetPassword2026!' });
      assert.equal(login.status, 200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await request('tasks', cookie, {})).status, 403);
      const changed = await request('account/initial-password', cookie, {
        password: 'Personal2026!',
        confirmPassword: 'Personal2026!',
      });
      assert.equal(changed.status, 200);
      const user = await db.user.findUniqueOrThrow({ where: { id: teacher.user.id } });
      assert.ok(await compare('Personal2026!', user.passwordHash));
      assert.equal(user.mustChangePassword, false);
    });
    await t.test(
      '超级管理员可改自己的姓名、账号和8位数字密码，保留权限并要求重新登录',
      async () => {
        const username = `admin_${tag}`;
        const r = await request(`teachers/${admin.user.id}/update`, admin.cookie, {
          name: '超级管理员',
          username,
          password: '87654321',
        });
        assert.equal(r.status, 200);
        const result = await r.json();
        assert.equal(result.reauthenticate, true);
        assert.equal(result.teacher.isSuperAdmin, true);
        assert.equal(result.teacher.mustChangePassword, false);
        assert.ok(r.headers.get('set-cookie')?.includes('grade_session='));
        assert.equal((await request('teachers', admin.cookie)).status, 401);
        const login = await request('login', '', { username, password: '87654321' });
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie')!.split(';')[0];
        assert.equal((await request('teachers', cookie)).status, 200);
        assert.equal(
          (await request(`teachers/${admin.user.id}/delete`, cookie, { confirmUsername: username }))
            .status,
          403,
        );
      },
    );
  } finally {
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
