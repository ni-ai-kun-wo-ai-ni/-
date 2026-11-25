import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import ExcelJS from 'exceljs';
import { assertSafeXlsx, MAX_XLSX_EXPANDED_BYTES } from '../src/lib/xlsx-safety';
import { db, writeTransaction } from '../src/lib/db';
import { activeActor, tokenHash, HttpError } from '../src/lib/auth';
import { canPublishTasks } from '../src/lib/permissions';
import { createStudent } from '../src/lib/students';
import { completeInitialPassword } from '../src/lib/initial-password';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

function zip(entries: { name: string; data: Buffer; declaredSize?: number }[]) {
  const local: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      data = deflateRawSync(entry.data);
    const header = Buffer.alloc(30),
      central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(entry.data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.declaredSize ?? entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const end = Buffer.alloc(22),
    central = Buffer.concat(directory);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Uint8Array.from(Buffer.concat([...local, central, end])).buffer;
}
test('Excel安全预检：正常文件通过，实际解压炸弹、XML实体和异常目录被拒绝', async () => {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('名单');
  sheet.addRow(['姓名', '学号']);
  sheet.addRow(['虚构', '001']);
  const validBytes = new Uint8Array(await book.xlsx.writeBuffer());
  assert.doesNotThrow(() => assertSafeXlsx(validBytes.buffer));
  const baseEntries = [
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') },
  ];
  assert.doesNotThrow(() => assertSafeXlsx(zip(baseEntries)));
  assert.throws(
    () =>
      assertSafeXlsx(
        zip([
          ...baseEntries,
          { name: 'bomb.xml', data: Buffer.alloc(MAX_XLSX_EXPANDED_BYTES + 1), declaredSize: 0 },
        ]),
      ),
    (e) => e instanceof HttpError && e.status === 413,
  );
  assert.throws(
    () =>
      assertSafeXlsx(
        zip([
          ...baseEntries,
          {
            name: 'evil.xml',
            data: Buffer.from('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x/>'),
          },
        ]),
      ),
    /XML/,
  );
  assert.throws(
    () =>
      assertSafeXlsx(
        zip([
          ...baseEntries,
          {
            name: 'xl/worksheets/sheet1.xml',
            data: Buffer.from('<worksheet>' + '<c/>'.repeat(20001) + '</worksheet>'),
          },
        ]),
      ),
    (e) => e instanceof HttpError && e.status === 413,
  );
  assert.throws(() =>
    assertSafeXlsx(zip([...baseEntries, { name: '../escape.xml', data: Buffer.from('x') }])),
  );
  assert.throws(() => assertSafeXlsx(zip([...baseEntries, baseEntries[0]])));
  assert.throws(
    () => assertSafeXlsx(new ArrayBuffer(3)),
    (e) => e instanceof HttpError && e.status === 400,
  );
});

test('安全复查：事务重新核验、改密竞态、最小统计数据与安全响应头', async (t) => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
  const ids: string[] = [],
    tag = randomBytes(6).toString('hex');
  let gradeId = '',
    taskId = '';
  const passwordHash = await hash('AuditOld2026!', 12);
  async function actor(role: string, classId?: string, gradeId?: string) {
    const user = await db.user.create({
      data: {
        username: `audit_${tag}_${ids.length}`,
        name: '虚构安全复查',
        role,
        classId,
        gradeId,
        passwordHash,
        isClassOfficer: role === 'STUDENT' && !!classId,
        isStudentOfficer: role === 'STUDENT' && !!gradeId,
      },
    });
    ids.push(user.id);
    const token = randomBytes(32).toString('hex'),
      sessionId = tokenHash(token);
    await db.session.create({
      data: { id: sessionId, userId: user.id, expiresAt: new Date(Date.now() + 3600000) },
    });
    return { user: { ...user, sessionId }, cookie: `grade_session=${token}` };
  }
  async function request(path: string, cookie: string, body?: unknown, origin = base) {
    return fetch(`${base}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin, cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  try {
    const grade = await db.grade.create({
      data: { name: '安全复查' + tag, classes: { create: { name: '虚构班' } } },
      include: { classes: true },
    });
    gradeId = grade.id;
    const teacher = await actor('TEACHER'),
      officer = await actor('STUDENT', grade.classes[0].id),
      unassigned = await actor('STUDENT', undefined, grade.id),
      queued = await actor('TEACHER');
    const task = await db.collectionTask.create({
      data: {
        title: '安全复查',
        description: '',
        gradeId,
        creatorId: teacher.user.id,
        status: 'OPEN',
        deadline: new Date(Date.now() + 86400000),
        targets: { create: [{ userId: officer.user.id }, { userId: unassigned.user.id }] },
        fields: { create: { label: '意见', type: 'TEXT', position: 0 } },
      },
    });
    taskId = task.id;
    await t.test('统计不暴露账号状态，未分班分组可筛选和导出，班干部不能扩大范围', async () => {
      const report = await (await request(`tasks/${taskId}/report`, teacher.cookie)).json();
      assert.equal(report.rows.length, 2);
      for (const row of report.rows)
        for (const key of [
          'username',
          'role',
          'isSuperAdmin',
          'isStudentOfficer',
          'mustChangePassword',
          'passwordHash',
        ])
          assert.ok(!(key in row), key);
      const filtered = await (
        await request(`tasks/${taskId}/report?classId=__unassigned__`, teacher.cookie)
      ).json();
      assert.equal(filtered.rows.length, 1);
      assert.equal(filtered.rows[0].id, unassigned.user.id);
      assert.equal(
        (await request(`tasks/${taskId}/export?classId=__unassigned__`, teacher.cookie)).status,
        200,
      );
      assert.equal(
        (await request(`tasks/${taskId}/report?classId=__unassigned__`, officer.cookie)).status,
        403,
      );
    });
    await t.test('写入前再次检查：计算密码时已注销的会话无法继续创建学生', async () => {
      const pending = createStudent(queued.user, {
        name: '不应创建',
        studentNumber: `blocked_${tag}`,
        isClassOfficer: false,
      });
      await db.session.delete({ where: { id: queued.user.sessionId } });
      await assert.rejects(pending, (e) => e instanceof HttpError && e.status === 401);
      assert.equal(await db.user.count({ where: { username: `blocked_${tag}` } }), 0);
      await db.user.update({
        where: { id: unassigned.user.id },
        data: { isStudentOfficer: false },
      });
      assert.equal(
        canPublishTasks(await writeTransaction((tx) => activeActor(tx, unassigned.user))),
        false,
      );
    });
    await t.test('首次改密绑定原凭据，期间被重设密码后旧请求不能覆盖新凭据', async () => {
      const first = await actor('STUDENT');
      await db.user.update({ where: { id: first.user.id }, data: { mustChangePassword: true } });
      const replacement = await hash('ResetByTeacher2026!', 12);
      const pending = completeInitialPassword(
        first.user.id,
        { password: 'Attending2026!', confirmPassword: 'Attending2026!' },
        passwordHash,
        first.user.sessionId,
      );
      await db.user.update({ where: { id: first.user.id }, data: { passwordHash: replacement } });
      await assert.rejects(pending, (e) => e instanceof HttpError && e.status === 401);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: first.user.id } })).passwordHash,
        replacement,
      );
    });
    await t.test(
      '个人改密需要原密码并拒绝伪造对象，成功使其他设备退出且轮换本设备会话',
      async () => {
        const otherToken = randomBytes(32).toString('hex');
        await db.session.create({
          data: {
            id: tokenHash(otherToken),
            userId: officer.user.id,
            expiresAt: new Date(Date.now() + 3600000),
          },
        });
        const payload = {
          oldPassword: 'AuditOld2026!',
          password: 'AuditNew2026!',
          confirmPassword: 'AuditNew2026!',
        };
        assert.equal(
          (await request('account/password', officer.cookie, payload, 'https://evil.example'))
            .status,
          403,
        );
        assert.equal(
          (await request('account/password', officer.cookie, { ...payload, oldPassword: 'wrong' }))
            .status,
          400,
        );
        assert.equal(
          (
            await request('account/password', officer.cookie, {
              ...payload,
              userId: teacher.user.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request('account/password', officer.cookie, {
              ...payload,
              password: '12345678',
              confirmPassword: '12345678',
            })
          ).status,
          400,
        );
        const changed = await request('account/password', officer.cookie, payload);
        assert.equal(changed.status, 200);
        const cookie = changed.headers.get('set-cookie')!.split(';')[0];
        assert.notEqual(cookie, officer.cookie);
        assert.equal((await request('bootstrap', cookie)).status, 200);
        assert.equal((await request('bootstrap', officer.cookie)).status, 401);
        assert.equal((await request('bootstrap', `grade_session=${otherToken}`)).status, 401);
        assert.ok(
          await compare(
            payload.password,
            (await db.user.findUniqueOrThrow({ where: { id: officer.user.id } })).passwordHash,
          ),
        );
        const login = await request('login', '', {
          username: officer.user.username,
          password: payload.password,
        });
        assert.equal(login.status, 200);
      },
    );
    await t.test('页面防嵌入、内容类型和隐私响应头生效，API错误也禁止缓存', async () => {
      const page = await fetch(base);
      assert.equal(page.headers.get('x-frame-options'), 'DENY');
      assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
      assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
      const denied = await request('bootstrap', '');
      assert.equal(denied.status, 401);
      assert.match(denied.headers.get('cache-control')!, /no-store/);
    });
  } finally {
    if (taskId) {
      await db.submission.deleteMany({ where: { taskId } });
      await db.collectionTask.delete({ where: { id: taskId } });
    }
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (gradeId) {
      await db.class.deleteMany({ where: { gradeId } });
      await db.grade.delete({ where: { id: gradeId } });
    }
    await db.$disconnect();
  }
});
