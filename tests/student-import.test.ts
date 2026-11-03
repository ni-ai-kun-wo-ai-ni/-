import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { compare } from 'bcryptjs';
import type { StudentImportPreview } from '../src/lib/student-import-types';

const db = new PrismaClient();
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
async function json(path: string, cookie = '', body?: unknown) {
  return fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin: base, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(username: string, password = 'Demo2026!') {
  const r = await json('login', '', { username, password });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie')!.split(';')[0];
}
async function workbook(rows: ExcelJS.CellValue[][], headers = ['姓名', '学号']) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('名单');
  sheet.addRow(headers);
  rows.forEach((row) => sheet.addRow(row));
  return new Uint8Array(await book.xlsx.writeBuffer());
}
async function upload(
  cookie: string,
  classId: string,
  bytes: Uint8Array,
  mode = 'preview',
  extra?: Record<string, string>,
  origin = base,
  filename = '名单.xlsx',
) {
  const form = new FormData();
  form.set('classId', classId);
  form.set('mode', mode);
  form.set('file', new Blob([bytes as BlobPart]), filename);
  for (const [key, value] of Object.entries(extra || {})) form.set(key, value);
  return fetch(`${base}/api/students/import`, {
    method: 'POST',
    headers: { cookie, origin },
    body: form,
  });
}

test('学生表格导入：教师权限、逐行预览、整批验证与首次改密', async (t) => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), '仅允许本机独立测试库');
  const tag = randomUUID().replaceAll('-', '').slice(0, 10);
  const prefix = `imp_${tag}_`;
  let classId = '',
    gradeId = '';
  try {
    const teacher = await login('teacher001'),
      student = await login('student001'),
      monitor = await login('monitor001');
    const grade = await db.grade.create({ data: { name: `虚构导入测试年级_${tag}` } });
    gradeId = grade.id;
    const cls = await db.class.create({ data: { name: '虚构导入测试班', gradeId } });
    classId = cls.id;
    const good = await workbook([
      ['虚构导入同学甲', `${prefix}001`],
      ['虚构导入同学乙', `${prefix}002`],
    ]);

    await t.test('匿名、普通学生与班干部不能上传或下载模板，跨站请求拒绝', async () => {
      for (const [cookie, expected] of [
        ['', 401],
        [student, 403],
        [monitor, 403],
      ] as const) {
        assert.equal((await upload(cookie, classId, good)).status, expected);
        assert.equal((await json('students/import-template', cookie)).status, expected);
      }
      assert.equal(
        (await upload(teacher, classId, good, 'commit', undefined, 'https://evil.example')).status,
        403,
      );
    });
    await t.test('教师下载的模板包含姓名学号列，学号列为文本，可填写后预览', async () => {
      const response = await json('students/import-template', teacher);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-disposition')!, /attachment/);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await response.arrayBuffer());
      const sheet = book.worksheets[0];
      assert.equal(sheet.getCell('A1').text, '姓名');
      assert.equal(sheet.getCell('B1').text, '学号');
      assert.equal(sheet.getColumn(2).numFmt, '@');
      sheet.addRow(['模板测试同学', `${prefix}template`]);
      assert.equal(
        (await upload(teacher, classId, new Uint8Array(await book.xlsx.writeBuffer()))).status,
        200,
      );
    });
    await t.test('预览只读，支持调换列序、空行、额外列和数字学号显示的前导零', async () => {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet('名单');
      sheet.addRow(['学号', '姓名', '备注']);
      sheet.addRow([`${prefix}000`, '  虚构空白测试  ', '忽略']);
      sheet.addRow([]);
      sheet.addRow([123, '虚构数字测试']);
      sheet.getCell('A4').numFmt = '000000';
      const response = await upload(
        teacher,
        classId,
        new Uint8Array(await book.xlsx.writeBuffer()),
      );
      assert.equal(response.status, 200);
      const preview: StudentImportPreview = await response.json();
      assert.equal(preview.canImport, true);
      assert.equal(preview.rows[0].name, '虚构空白测试');
      assert.equal(preview.rows[1].studentNumber, '000123');
      assert.equal(preview.rows[1].rowNumber, 4);
      assert.equal(await db.user.count({ where: { classId } }), 0);
    });
    await t.test('逐行报告空姓名、非法学号、表内重复、公式与长数字精度问题，整批拒绝', async () => {
      const bad = await workbook([
        ['', `${prefix}bad1`],
        ['虚构重复甲', `${prefix}dup`],
        ['虚构重复乙', `${prefix}dup`],
        ['虚构格式', '12 34'],
        [{ formula: '"虚构公式"', result: '虚构公式' }, `${prefix}formula`],
        ['虚构长学号', 1234567890123456],
        ['有效同学', `${prefix}valid`],
      ]);
      const response = await upload(teacher, classId, bad);
      assert.equal(response.status, 200);
      const preview: StudentImportPreview = await response.json();
      assert.equal(preview.canImport, false);
      assert.ok(preview.rows.slice(0, 6).every((row) => row.errors.length));
      assert.match(preview.rows[1].errors.join(), /第 3、4 行/);
      assert.equal((await upload(teacher, classId, bad, 'commit')).status, 400);
      assert.equal(await db.user.count({ where: { classId } }), 0);
    });
    await t.test('已有学号和教师登录账号冲突不会覆盖，也不会创建同批的有效学生', async () => {
      const source = await db.user.findUniqueOrThrow({ where: { username: 'student001' } });
      const bad = await workbook([
        ['虚构冲突', source.studentNumber!],
        ['虚构教师冲突', 'teacher001'],
        ['虚构有效', `${prefix}valid`],
      ]);
      const preview: StudentImportPreview = await (await upload(teacher, classId, bad)).json();
      assert.equal(preview.canImport, false);
      assert.match(preview.rows[0].errors.join(), /已存在/);
      assert.match(preview.rows[1].errors.join(), /已存在/);
      assert.equal((await upload(teacher, classId, bad, 'commit')).status, 400);
      assert.deepEqual(await db.user.findUnique({ where: { id: source.id } }), source);
      assert.equal(await db.user.count({ where: { classId } }), 0);
    });
    await t.test('拒绝坏文件、旧xls、缺少或重复表头、空表及超过200人', async () => {
      assert.equal((await upload(teacher, classId, new Uint8Array([1, 2, 3]))).status, 400);
      assert.equal(
        (await upload(teacher, classId, good, 'preview', undefined, base, '名单.xls')).status,
        400,
      );
      for (const bytes of [
        await workbook([['虚构', '123']], ['姓名', '编号']),
        await workbook([['虚构', '123', '456']], ['姓名', '学号', '学号']),
        await workbook([]),
        await workbook(Array.from({ length: 201 }, (_, i) => ['虚构同学', `${prefix}limit${i}`])),
      ])
        assert.equal((await upload(teacher, classId, bytes)).status, 400);
      assert.equal((await upload(teacher, classId, new Uint8Array(1024 * 1024 + 1))).status, 413);
    });
    await t.test('后端拒绝无效班级与伪造角色、密码、数据等字段', async () => {
      assert.equal((await upload(teacher, 'missing', good)).status, 400);
      assert.equal(
        (await upload(teacher, classId, good, 'commit', { role: 'TEACHER' })).status,
        400,
      );
      assert.equal(
        (await upload(teacher, classId, good, 'commit', { password: 'Custom123!' })).status,
        400,
      );
      assert.equal((await upload(teacher, classId, good, 'commit', { rows: '[]' })).status, 400);
      assert.equal(await db.user.count({ where: { classId } }), 0);
    });
    await t.test('有效表格整批创建，密码独立哈希、账号即学号，首次登录门禁有效', async () => {
      const preview: StudentImportPreview = await (await upload(teacher, classId, good)).json();
      assert.equal(preview.canImport, true);
      const response = await upload(teacher, classId, good, 'commit');
      assert.equal(response.status, 200);
      assert.equal((await response.json()).imported, 2);
      const users = await db.user.findMany({ where: { classId }, orderBy: { username: 'asc' } });
      assert.equal(users.length, 2);
      for (const user of users) {
        assert.equal(user.username, user.studentNumber);
        assert.equal(user.role, 'STUDENT');
        assert.equal(user.isClassOfficer, false);
        assert.equal(user.mustChangePassword, true);
        assert.equal(await compare('123456', user.passwordHash), true);
        assert.equal(await db.taskTarget.count({ where: { userId: user.id } }), 0);
      }
      assert.notEqual(users[0].passwordHash, users[1].passwordHash);
      const cookie = await login(users[0].username, '123456');
      assert.equal((await json('tasks', cookie, {})).status, 403);
      const change = await json('account/initial-password', cookie, {
        password: 'ImportNew2026!',
        confirmPassword: 'ImportNew2026!',
      });
      assert.equal(change.status, 200);
      assert.equal(
        (await json('login', '', { username: users[0].username, password: '123456' })).status,
        401,
      );
      await login(users[0].username, 'ImportNew2026!');
    });
    await t.test('重复导入不重复创建，预览后出现冲突也不会部分导入或覆盖', async () => {
      assert.equal((await upload(teacher, classId, good, 'commit')).status, 400);
      const bytes = await workbook([
        ['虚构新同学', `${prefix}race1`],
        ['虚构冲突同学', `${prefix}race2`],
      ]);
      assert.equal(
        ((await (await upload(teacher, classId, bytes)).json()) as StudentImportPreview).canImport,
        true,
      );
      const actor = await db.user.findUniqueOrThrow({ where: { username: 'teacher001' } });
      await db.user.create({
        data: {
          username: `${prefix}race2`,
          studentNumber: `${prefix}race2`,
          name: '保留原姓名',
          passwordHash: actor.passwordHash,
          classId,
        },
      });
      assert.equal((await upload(teacher, classId, bytes, 'commit')).status, 400);
      assert.equal(await db.user.count({ where: { username: `${prefix}race1` } }), 0);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { username: `${prefix}race2` } })).name,
        '保留原姓名',
      );
    });
    await t.test('并发导入同一表格最多创建一批；预览后班级删除会被重新校验', async () => {
      const bytes = await workbook([['虚构并发同学', `${prefix}concurrent`]]);
      const results = await Promise.all([
        upload(teacher, classId, bytes, 'commit'),
        upload(teacher, classId, bytes, 'commit'),
      ]);
      assert.equal(results.filter((r) => r.status === 200).length, 1);
      assert.ok(results.every((r) => [200, 400, 409].includes(r.status)));
      assert.equal(await db.user.count({ where: { username: `${prefix}concurrent` } }), 1);
      const emptyClass = await db.class.create({ data: { name: '预览后删除测试班', gradeId } });
      try {
        const goodPreview: StudentImportPreview = await (
          await upload(teacher, emptyClass.id, await workbook([['虚构', `${prefix}deleted`]]))
        ).json();
        assert.equal(goodPreview.canImport, true);
      } finally {
        await db.class.delete({ where: { id: emptyClass.id } });
      }
      assert.equal((await upload(teacher, emptyClass.id, good, 'commit')).status, 400);
    });
  } finally {
    const users = await db.user.findMany({
      where: { username: { startsWith: prefix } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    await db.taskTarget.deleteMany({ where: { userId: { in: ids } } });
    await db.submission.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (classId) await db.class.deleteMany({ where: { id: classId } });
    if (gradeId) await db.grade.deleteMany({ where: { id: gradeId } });
    await db.$disconnect();
  }
});
