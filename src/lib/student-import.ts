import ExcelJS from 'exceljs';
import { assertSafeXlsx } from './xlsx-safety';
import { Prisma, type User } from '@prisma/client';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { db, writeTransaction } from './db';
import { HttpError, teacherOnly } from './auth';
import { activeActor } from './auth';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type StudentImportRow,
  type StudentImportEdit,
} from './student-import-types';

const editsSchema = z
  .array(
    z
      .object({
        rowNumber: z.number().int().min(2).max(10000),
        name: z.string().max(200).optional(),
        studentNumber: z.string().max(200).optional(),
        remove: z.boolean().optional(),
        isClassOfficer: z.boolean().optional(),
        isStudentOfficer: z.boolean().optional(),
      })
      .strict(),
  )
  .max(MAX_IMPORT_ROWS);

// 限制整个请求大小，包括没有 Content-Length 的分块上传。
async function readUpload(request: Request) {
  const limit = MAX_IMPORT_BYTES + 64 * 1024;
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data'))
    throw new HttpError(400, '请上传 Excel 文件');
  if (Number(request.headers.get('content-length')) > limit)
    throw new HttpError(413, '文件不能超过 1 MB');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '未收到上传文件');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 60000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, '文件不能超过 1 MB');
      }
      chunks.push(value);
    }
    if (timedOut) throw new HttpError(408, '接收表格超时，请重新上传');
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
  } catch {
    throw new HttpError(400, '上传格式不正确');
  }
  for (const key of form.keys()) {
    if (
      !['file', 'classId', 'gradeId', 'mode', 'edits'].includes(key) ||
      form.getAll(key).length !== 1
    )
      throw new HttpError(400, '上传字段不正确');
  }
  const file = form.get('file'),
    classId = form.get('classId'),
    gradeId = form.get('gradeId'),
    mode = form.get('mode');
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.xlsx'))
    throw new HttpError(400, '仅支持 .xlsx 文件，请先在 Excel 或 WPS 中另存为该格式');
  if (!file.size || file.size > MAX_IMPORT_BYTES)
    throw new HttpError(413, '请选择非空且不超过 1 MB 的文件');
  if (
    (classId !== null && typeof classId !== 'string') ||
    (gradeId !== null && typeof gradeId !== 'string') ||
    !['preview', 'commit'].includes(String(mode))
  )
    throw new HttpError(400, '归属或导入操作不正确');
  let edits: StudentImportEdit[] = [];
  if (form.has('edits')) {
    const value = form.get('edits');
    if (typeof value !== 'string') throw new HttpError(400, '预览修改格式不正确');
    try {
      edits = editsSchema.parse(JSON.parse(value));
    } catch {
      throw new HttpError(400, '预览修改格式不正确，请重新检查');
    }
    if (new Set(edits.map((edit) => edit.rowNumber)).size !== edits.length)
      throw new HttpError(400, '预览修改包含重复的表格行号');
  }
  return { file, classId: classId || null, gradeId: gradeId || null, mode, edits };
}

function cellText(cell: ExcelJS.Cell, numeric = false) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/^\uFEFF/, '').trim();
  if (typeof value === 'object' && 'richText' in value)
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim();
  if (
    numeric &&
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 1e15
  ) {
    // 保留 Excel 中使用 000… 格式显示的前导零；更长学号必须以文本保存，避免精度丢失。
    const text = String(value);
    return /^0+$/.test(cell.numFmt) ? text.padStart(cell.numFmt.length, '0') : text;
  }
  throw new Error(
    numeric ? '学号请使用文本，勿用公式、小数或超过15位的数字单元格' : '姓名请使用文本，勿用公式',
  );
}

async function parseStudents(file: File, edits: StudentImportEdit[]) {
  const book = new ExcelJS.Workbook();
  const bytes = await file.arrayBuffer();
  assertSafeXlsx(bytes);
  try {
    await book.xlsx.load(bytes);
  } catch {
    throw new HttpError(400, '无法读取文件，请使用未加密的有效 .xlsx 文件');
  }
  const sheet = book.worksheets[0];
  if (!sheet) throw new HttpError(400, '文件中没有工作表');
  if (sheet.rowCount > 10000 || sheet.columnCount > 100)
    throw new HttpError(400, '表格范围过大，请使用导入模板，仅保留学生信息');
  const columns = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    let text: string;
    try {
      text = cellText(cell);
    } catch {
      return;
    }
    if (!['姓名', '学号'].includes(text)) return;
    if (columns.has(text)) throw new HttpError(400, `第一行存在重复的“${text}”列`);
    columns.set(text, col);
  });
  if (!columns.has('姓名') || !columns.has('学号'))
    throw new HttpError(400, '第一行必须包含“姓名”和“学号”两列');
  const rows: StudentImportRow[] = [];
  const editsByRow = new Map(edits.map((edit) => [edit.rowNumber, edit]));
  const sourceRows = new Set<number>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: StudentImportRow = {
      rowNumber,
      name: '',
      studentNumber: '',
      isClassOfficer: false,
      isStudentOfficer: false,
      errors: [],
    };
    let nameError = '',
      numberError = '';
    try {
      record.name = cellText(row.getCell(columns.get('姓名')!));
    } catch (error) {
      nameError = (error as Error).message;
    }
    try {
      record.studentNumber = cellText(row.getCell(columns.get('学号')!), true);
    } catch (error) {
      numberError = (error as Error).message;
    }
    if (!record.name && !record.studentNumber && !nameError && !numberError) return;
    sourceRows.add(rowNumber);
    const edit = editsByRow.get(rowNumber);
    if (edit?.remove) return;
    record.isClassOfficer = edit?.isClassOfficer ?? false;
    record.isStudentOfficer = edit?.isStudentOfficer ?? false;
    if (edit?.name !== undefined) record.name = edit.name.trim();
    else if (nameError) record.errors.push(nameError);
    if (edit?.studentNumber !== undefined) record.studentNumber = edit.studentNumber.trim();
    else if (numberError) record.errors.push(numberError);
    if (!record.name || record.name.length > 60) record.errors.push('姓名必填，最长60字');
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(record.studentNumber))
      record.errors.push('学号须为1～32位字母、数字、下划线或横线');
    rows.push(record);
  });
  if (edits.some((edit) => !sourceRows.has(edit.rowNumber)))
    throw new HttpError(400, '修改的行不在原始名单中，请重新上传表格');
  if (!rows.length) throw new HttpError(400, '没有可导入的学生，请至少保留一行有效名单');
  if (rows.length > MAX_IMPORT_ROWS)
    throw new HttpError(400, `每次最多导入 ${MAX_IMPORT_ROWS} 人，请分批上传`);
  const occurrences = new Map<string, number[]>();
  for (const row of rows) {
    const group = occurrences.get(row.studentNumber) || [];
    group.push(row.rowNumber);
    occurrences.set(row.studentNumber, group);
  }
  for (const row of rows)
    if (row.studentNumber && occurrences.get(row.studentNumber)!.length > 1)
      row.errors.push(`表内学号重复（第 ${occurrences.get(row.studentNumber)!.join('、')} 行）`);
  return rows;
}

async function conflicts(client: Prisma.TransactionClient, rows: StudentImportRow[]) {
  const numbers = rows.map((row) => row.studentNumber);
  return client.user.findMany({
    where: { OR: [{ username: { in: numbers } }, { studentNumber: { in: numbers } }] },
    select: { username: true, studentNumber: true },
  });
}

export async function importStudents(actor: User, request: Request) {
  teacherOnly(actor);
  const { file, classId, gradeId, mode, edits } = await readUpload(request);
  const cls = classId
    ? await db.class.findUnique({ where: { id: classId }, include: { grade: true } })
    : null;
  if (classId && !cls) throw new HttpError(400, '所选班级不存在，请刷新后重试');
  const grade = gradeId ? await db.grade.findUnique({ where: { id: gradeId } }) : null;
  if (gradeId && !grade) throw new HttpError(400, '所选年级不存在，请刷新后重试');
  if (cls && gradeId && cls.gradeId !== gradeId) throw new HttpError(400, '班级不属于所选年级');
  const rows = await parseStudents(file, edits);
  for (const row of rows) {
    if (row.isClassOfficer && !classId) row.errors.push('设为班干部需先选择班级');
  }
  const existing = await conflicts(db, rows);
  const used = new Set(existing.flatMap((user) => [user.username, user.studentNumber]));
  for (const row of rows)
    if (used.has(row.studentNumber)) row.errors.push('学号或登录账号已存在，不会覆盖已有学生');
  const canImport = rows.every((row) => !row.errors.length);
  if (mode === 'preview')
    return {
      rows,
      canImport,
      className: cls?.name || null,
      gradeName: cls?.grade.name || grade?.name || null,
    };
  if (!canImport)
    throw new HttpError(400, '表格仍有错误或重复账号，本次未导入任何学生，请重新预览并修正');
  // 每个账号使用独立盐；慢速密码计算在事务外完成，避免长期锁住 SQLite。
  const records: Prisma.UserCreateManyInput[] = [];
  for (const row of rows)
    records.push({
      name: row.name,
      studentNumber: row.studentNumber,
      username: row.studentNumber,
      role: 'STUDENT',
      isClassOfficer: row.isClassOfficer,
      isStudentOfficer: row.isStudentOfficer,
      mustChangePassword: true,
      classId,
      gradeId: classId ? null : gradeId,
      passwordHash: await hash('123456', 12),
    });
  try {
    await writeTransaction(
      async (tx) => {
        teacherOnly(await activeActor(tx, actor));
        // 确认导入时重新检查，不能依赖之前预览的结果或客户端提交的身份。
        if (classId && !(await tx.class.findUnique({ where: { id: classId } })))
          throw new HttpError(409, '班级已被删除，请重新选择');
        if (gradeId && !(await tx.grade.findUnique({ where: { id: gradeId } })))
          throw new HttpError(409, '年级已被删除，请重新选择');
        if ((await conflicts(tx, rows)).length)
          throw new HttpError(409, '预览后已有账号被创建，本次未导入任何学生，请重新预览');
        await tx.user.createMany({ data: records });
      },
      { timeout: 10000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003', 'P2034'].includes(error.code)
    )
      throw new HttpError(409, '账号或班级已变化，本次未导入任何学生，请重新预览');
    throw error;
  }
  return { imported: records.length };
}

export async function studentImportTemplate(actor: User) {
  teacherOnly(actor);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('学生名单');
  sheet.columns = [
    { header: '姓名', key: 'name', width: 20 },
    { header: '学号', key: 'studentNumber', width: 28 },
  ];
  sheet.getColumn(2).numFmt = '@';
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B5B' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return book.xlsx.writeBuffer();
}
