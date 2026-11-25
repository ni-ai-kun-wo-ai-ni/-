import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { tokenHash } from '../src/lib/auth';
const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
async function request(path: string, cookie: string, body?: unknown) {
  return fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin: base, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
test('学生干部：项目归属隔离、全年级发布、人员隔离、即时撤权与任务保留', async (t) => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
  const tag = randomBytes(8).toString('hex');
  const ids: string[] = [];
  let gradeId = '';
  const taskIds: string[] = [];
  async function actor(
    role: string,
    classId?: string,
    isStudentOfficer = false,
    isClassOfficer = false,
  ) {
    const user = await db.user.create({
      data: {
        username: `officer_${tag}_${ids.length}`,
        name: '虚构干部测试',
        passwordHash: 'unused',
        role,
        classId,
        isStudentOfficer,
        isClassOfficer,
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
    const grade = await db.grade.create({
      data: { name: `干部测试${tag}`, classes: { create: [{ name: '一班' }, { name: '二班' }] } },
      include: { classes: true },
    });
    gradeId = grade.id;
    const teacher = await actor('TEACHER');
    const owner = await actor('STUDENT', grade.classes[0].id, true);
    const other = await actor('STUDENT', grade.classes[1].id, true);
    const student = await actor('STUDENT', grade.classes[0].id);
    const monitor = await actor('STUDENT', grade.classes[0].id, false, true);
    const input = {
      title: '干部项目',
      description: '',
      gradeId,
      deadline: new Date(Date.now() + 86400000).toISOString(),
      allowEdit: true,
      officerCanView: false,
      fields: [{ label: '意见', type: 'TEXT', required: false, options: [] }],
    };
    let taskId = '';
    await t.test('只有教师和学生干部可发布；创建者固定为当前用户，全年级含跨班学生', async () => {
      for (const who of [student, monitor])
        assert.equal((await request('tasks', who.cookie, input)).status, 403);
      const res = await request('tasks', owner.cookie, { ...input, creatorId: teacher.user.id });
      assert.equal(res.status, 200);
      taskId = (await res.json()).id;
      taskIds.push(taskId);
      const task = await db.collectionTask.findUniqueOrThrow({
        where: { id: taskId },
        include: { targets: true },
      });
      assert.equal(task.creatorId, owner.user.id);
      assert.ok(task.targets.some((x) => x.userId === other.user.id));
    });
    await t.test('列表分开填写与管理；只暴露发布选人所需名册，无人员账号字段', async () => {
      const home = await (await request('bootstrap', owner.cookie)).json();
      assert.ok(home.managedTasks.some((x: { id: string }) => x.id === taskId));
      assert.ok(!home.tasks.some((x: { id: string }) => x.id === taskId));
      assert.deepEqual(home.students, []);
      assert.ok(home.publisherStudents.length);
      assert.equal(home.publisherStudents[0].username, undefined);
      const otherHome = await (await request('bootstrap', other.cookie)).json();
      assert.ok(!otherHome.managedTasks.some((x: { id: string }) => x.id === taskId));
    });
    await t.test('他人草稿、统计、导出及所有管理接口被拒绝，教师可管理', async () => {
      for (const suffix of ['', '/report', '/export']) {
        assert.equal((await request(`tasks/${taskId}${suffix}`, other.cookie)).status, 403);
        assert.equal((await request(`tasks/${taskId}${suffix}`, teacher.cookie)).status, 200);
      }
      for (const [action, body] of [
        ['status', { status: 'OPEN' }],
        ['deadline', { deadline: input.deadline }],
        ['delete', { confirmTitle: input.title }],
      ] as const)
        assert.equal((await request(`tasks/${taskId}/${action}`, other.cookie, body)).status, 403);
      assert.equal((await request(`tasks/${taskId}/report`, owner.cookie)).status, 200);
      assert.equal(
        (await request(`tasks/${taskId}/deadline`, owner.cookie, { deadline: input.deadline }))
          .status,
        200,
      );
      assert.equal(
        (await request(`tasks/${taskId}/status`, owner.cookie, { status: 'OPEN' })).status,
        200,
      );
    });
    await t.test('仍可填写他人发布给自己的任务，但不能查看结果或管理任务', async () => {
      assert.equal((await request(`tasks/${taskId}`, other.cookie)).status, 200);
      assert.equal(
        (await request(`tasks/${taskId}/submit`, other.cookie, {})).status,
        200,
      );
      assert.equal((await request(`tasks/${taskId}/report`, other.cookie)).status, 403);
      const report = await (await request(`tasks/${taskId}/report`, owner.cookie)).json();
      assert.equal(report.total, 4);
      assert.equal(report.canView, true);
      assert.equal((await request(`tasks/${taskId}/export`, owner.cookie)).status, 200);
    });
    await t.test('附件采用项目归属校验，班干部仍受答案可见性限制', async () => {
      const field = await db.formField.findFirstOrThrow({ where: { taskId } });
      const file = await db.attachment.create({
        data: {
          taskId,
          userId: other.user.id,
          fieldId: field.id,
          name: 'test.txt',
          mime: 'text/plain',
          size: 1,
          data: Buffer.from('a'),
        },
      });
      assert.equal((await request(`attachments/${file.id}`, owner.cookie)).status, 200);
      assert.equal((await request(`attachments/${file.id}`, student.cookie)).status, 403);
      assert.equal((await request(`tasks/${taskId}/report`, monitor.cookie)).status, 200);
      const report = await (await request(`tasks/${taskId}/report`, monitor.cookie)).json();
      assert.equal(report.canView, false);
      assert.equal(report.rows.length, 3);
    });
    await t.test('学生干部不能增删改人员或组织，也不能自行升级', async () => {
      for (const [path, body] of [
        ['grades', { name: '越权' }],
        ['classes', { name: '越权', gradeId }],
        ['students', {}],
        [`students/${student.user.id}/delete`, { confirmUsername: student.user.username }],
        [`students/${student.user.id}/transfer`, {}],
        [
          `students/${student.user.id}/identity`,
          { isClassOfficer: false, isStudentOfficer: true, fromClassId: student.user.classId },
        ],
        ['teachers', {}],
        [`teachers/${teacher.user.id}/update`, {}],
        [`teachers/${teacher.user.id}/delete`, {}],
      ] as const)
        assert.equal((await request(path, owner.cookie, body)).status, 403, path);
    });
    await t.test('教师设置身份，同一 Session 立即撤权与恢复；可结束和删除本人任务', async () => {
      const path = `students/${owner.user.id}/identity`;
      const body = {
        isClassOfficer: false,
        isStudentOfficer: false,
        fromClassId: owner.user.classId,
      };
      assert.equal((await request(path, teacher.cookie, body)).status, 200);
      assert.equal((await request(`tasks/${taskId}/report`, owner.cookie)).status, 403);
      assert.equal((await request('tasks', owner.cookie, input)).status, 403);
      assert.equal(
        (await request(path, teacher.cookie, { ...body, isStudentOfficer: true })).status,
        200,
      );
      assert.equal(
        (await request(`tasks/${taskId}/status`, owner.cookie, { status: 'CLOSED' })).status,
        200,
      );
      assert.equal(
        (await request(`tasks/${taskId}/delete`, owner.cookie, { confirmTitle: input.title }))
          .status,
        200,
      );
    });
    await t.test('删除学生干部账号时将项目交给教师，保留项目', async () => {
      const task = await db.collectionTask.create({
        data: {
          title: '保留任务',
          description: '',
          gradeId,
          creatorId: owner.user.id,
          deadline: new Date(),
        },
      });
      taskIds.push(task.id);
      assert.equal(
        (
          await request(`students/${owner.user.id}/delete`, teacher.cookie, {
            confirmUsername: owner.user.username,
          })
        ).status,
        200,
      );
      assert.equal(
        (await db.collectionTask.findUniqueOrThrow({ where: { id: task.id } })).creatorId,
        teacher.user.id,
      );
    });
  } finally {
    await db.submission.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.collectionTask.deleteMany({ where: { id: { in: taskIds } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (gradeId) {
      await db.class.deleteMany({ where: { gradeId } });
      await db.grade.delete({ where: { id: gradeId } });
    }
    await db.$disconnect();
  }
});
