import { changeOwnPassword } from '@/lib/account-password';
import { activeActor } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyLoginPassword } from '@/lib/login-verification';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { db, writeTransaction } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { traffic, sourceKey } from '@/lib/traffic-guard';
import { readJson } from '@/lib/request-body';
import { submissionHeaders, submissionHash } from '@/lib/submission-request';
import {
  checkOrigin,
  createSession,
  currentUser,
  HttpError,
  teacherOnly,
  tokenHash,
} from '@/lib/auth';
import { accessibleTask, publicUser, taskReport, taskStatus } from '@/lib/access';
import {
  assertSubmittable,
  downloadAttachment,
  prepareAttachments,
  readSubmission,
} from '@/lib/attachments';
import { attachmentSelect, attachmentUrl } from '@/lib/attachment-types';
import { taskSchema, validateAnswers } from '@/lib/validation';
import { createStudent, deleteStudent, transferStudent, setStudentIdentity } from '@/lib/students';
import { completeInitialPassword } from '@/lib/initial-password';
import { createGrade, createClass, deleteOrganization } from '@/lib/organization';
import { importStudents, studentImportTemplate } from '@/lib/student-import';
import { createTeacher, deleteTeacher, listTeachers, updateTeacher } from '@/lib/teachers';
import { canPublishTasks, canManageTask } from '@/lib/permissions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const json = (data: unknown, timing?: string) =>
  NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store', ...(timing ? { 'Server-Timing': timing } : {}) },
  });
// 本地 MVP 的登录限速；重启会清空，不代替生产环境限速。
const attempts = new Map<string, { count: number; until: number }>();
async function handle(req: NextRequest, ctx: Context) {
  const releases: (() => void)[] = [];
  try {
    releases.push(await traffic.requests.acquire());
    const { path } = await ctx.params;
    const key = path.join('/');
    const write = req.method === 'POST';
    if (write) checkOrigin(req);
    const source = sourceKey(req);
    traffic.rates.check('source:' + source, 6000, 60000);
    if (write && req.headers.get('content-type')?.startsWith('multipart/form-data'))
      releases.push(await traffic.uploads.acquire());
    if (key === 'login' && write) {
      traffic.rates.check('login-source:' + source, 200, 60000);
      const input = z
        .object({
          username: z.string().trim().min(1).max(60),
          password: z
            .string()
            .min(1)
            .max(72)
            .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
        })
        .parse(await readJson(req));
      traffic.rates.check('login-account:' + input.username, 20, 60000);
      releases.push(await traffic.expensive.acquire());
      const attempt = attempts.get(input.username);
      if (attempt && attempt.until > Date.now() && attempt.count >= 10)
        throw new HttpError(
          429,
          '尝试次数过多，请稍后重试',
          Math.max(1, Math.ceil((attempt.until - Date.now()) / 1000)),
        );
      const user = await db.user.findUnique({ where: { username: input.username } });
      const verified = await verifyLoginPassword(input.password, user?.passwordHash);
      if (
        !user ||
        (input.password === '123456' &&
          (!user.mustChangePassword || !['STUDENT', 'TEACHER'].includes(user.role))) ||
        (process.env.PUBLIC_MODE === 'true' && input.password === 'Demo2026!') ||
        !verified
      ) {
        const old = attempt && attempt.until > Date.now() ? attempt.count : 0;
        for (const [name, value] of attempts) if (value.until <= Date.now()) attempts.delete(name);
        if (!attempts.has(input.username) && attempts.size >= 5000)
          throw new HttpError(503, '登录服务繁忙，请稍后重试', 5);
        attempts.set(input.username, { count: old + 1, until: Date.now() + 900000 });
        throw new HttpError(401, '账号或密码错误');
      }
      attempts.delete(input.username);
      await createSession(user.id, user.passwordHash, user.username);
      return json({ ok: true, mustChangePassword: user.mustChangePassword });
    }
    const user = await currentUser();
    if (path[0] === 'attachments' && !write) {
      traffic.rates.check('download:' + user.id, 120, 60000);
      releases.push(await traffic.uploads.acquire());
    }
    traffic.rates.check('user:' + user.id, 600, 60000);
    if (write) traffic.rates.check('write:' + user.id, 360, 60000);
    if (path[0] === 'tasks' && path[2] === 'submit' && write)
      traffic.rates.check('submit:' + user.id, 40, 60000);
    if (path[2] === 'export') traffic.rates.check('export:' + user.id, 30, 60000);
    if (key === 'students/import') traffic.rates.check('import:' + user.id, 120, 60000);
    if (
      key === 'students/import' ||
      ['report', 'export'].includes(path[2]) ||
      (write &&
        ['students', 'teachers', 'account/initial-password', 'account/password'].includes(key))
    )
      releases.push(await traffic.expensive.acquire());
    if (key === 'account/password' && write) traffic.rates.check('password:' + user.id, 5, 900000);
    if (key === 'logout' && write) {
      const jar = await cookies();
      const token = jar.get('grade_session')?.value;
      if (token) await db.session.deleteMany({ where: { id: tokenHash(token) } });
      jar.delete('grade_session');
      return json({ ok: true });
    }
    if (key === 'account/initial-password' && write) {
      if (!user.mustChangePassword) throw new HttpError(409, '当前账号已设置密码');
      const updated = await completeInitialPassword(
        user.id,
        await readJson(req),
        user.passwordHash,
        user.sessionId,
      );
      await createSession(user.id, updated.passwordHash, updated.username);
      return json({ ok: true });
    }
    if (user.mustChangePassword) {
      if (key === 'bootstrap' && !write) {
        const me = await db.user.findUnique({ where: { id: user.id }, select: publicUser });
        return json({ user: me, tasks: [], officerTasks: [], students: [], grades: [] });
      }
      throw new HttpError(403, '请先设置自己的密码，再使用系统');
    }
    if (key === 'account/password' && write) {
      const updated = await changeOwnPassword(user, await readJson(req));
      await createSession(user.id, updated.passwordHash, updated.username);
      return json({ ok: true });
    }
    if (path.length === 2 && path[0] === 'attachments' && !write) {
      return await downloadAttachment(
        user,
        path[1],
        req.nextUrl.searchParams.get('preview') === '1',
      );
    }
    if (key === 'teachers') {
      return json(
        write ? await createTeacher(user, await readJson(req)) : await listTeachers(user),
      );
    }
    if (path.length === 3 && path[0] === 'teachers' && path[2] === 'delete' && write) {
      await deleteTeacher(user, path[1], await readJson(req));
      return json({ ok: true });
    }
    if (path.length === 3 && path[0] === 'teachers' && path[2] === 'update' && write) {
      const result = await updateTeacher(user, path[1], await readJson(req));
      if (result.reauthenticate) (await cookies()).delete('grade_session');
      return json(result);
    }
    if (key === 'bootstrap' && !write) {
      const me = await db.user.findUnique({ where: { id: user.id }, select: publicUser });
      const tasks = await db.collectionTask.findMany({
        where:
          user.role === 'TEACHER'
            ? {}
            : { status: { not: 'DRAFT' }, targets: { some: { userId: user.id } } },
        include: {
          managers: true,
          grade: true,
          submissions: {
            where: { userId: user.id },
            select: { submittedAt: true, updatedAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      const classmates =
        user.isClassOfficer && user.classId
          ? await db.user.findMany({
              where: { classId: user.classId, role: 'STUDENT' },
              select: { id: true },
            })
          : [];
      const officerTasks = classmates.length
        ? await db.collectionTask.findMany({
            where: {
              status: { not: 'DRAFT' },
              targets: { some: { userId: { in: classmates.map((s) => s.id) } } },
            },
            include: { managers: true },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      const grades = canPublishTasks(user)
        ? await db.grade.findMany({
            include: { classes: { include: { _count: { select: { students: true } } } } },
          })
        : [];
      const students =
        user.role === 'TEACHER'
          ? await db.user.findMany({
              where: { role: 'STUDENT' },
              select: publicUser,
              orderBy: { studentNumber: 'asc' },
            })
          : [];
      return json({
        user: me,
        managedTasks:
          user.role === 'STUDENT' && user.isStudentOfficer
            ? (
                await db.collectionTask.findMany({
                  where: {
                    OR: [{ creatorId: user.id }, { managers: { some: { userId: user.id } } }],
                  },
                  include: { managers: true },
                  orderBy: { createdAt: 'desc' },
                })
              ).map((t) => ({ ...t, displayStatus: taskStatus(t) }))
            : [],
        managerCandidates: canPublishTasks(user)
          ? await db.user.findMany({
              where: { role: 'STUDENT', isStudentOfficer: true, id: { not: user.id } },
              select: {
                id: true,
                name: true,
                studentNumber: true,
                class: { select: { id: true, name: true, gradeId: true } },
              },
              orderBy: { studentNumber: 'asc' },
            })
          : [],
        publisherStudents:
          user.role === 'STUDENT' && user.isStudentOfficer
            ? await db.user.findMany({
                where: { role: 'STUDENT' },
                select: {
                  id: true,
                  name: true,
                  studentNumber: true,
                  gradeId: true,
                  class: { select: { id: true, name: true, gradeId: true } },
                },
                orderBy: { studentNumber: 'asc' },
              })
            : [],
        tasks: tasks.map((t) => ({ ...t, displayStatus: taskStatus(t) })),
        officerTasks: officerTasks.map((t) => ({ ...t, displayStatus: taskStatus(t) })),
        grades,
        students,
      });
    }
    if (key === 'grades' && write) {
      teacherOnly(user);
      return json(await createGrade(user, await readJson(req)));
    }
    if (key === 'classes' && write) {
      teacherOnly(user);
      return json(await createClass(user, await readJson(req)));
    }
    if (
      path.length === 3 &&
      ['grades', 'classes'].includes(path[0]) &&
      path[2] === 'delete' &&
      write
    ) {
      teacherOnly(user);
      await deleteOrganization(
        user,
        path[0] === 'grades' ? 'grade' : 'class',
        path[1],
        await readJson(req),
      );
      return json({ ok: true });
    }
    if (key === 'students' && write) {
      teacherOnly(user);
      return json(await createStudent(user, await readJson(req)));
    }
    if (key === 'students/import' && write) {
      teacherOnly(user);
      return json(await importStudents(user, req));
    }
    if (key === 'students/import-template' && !write) {
      teacherOnly(user);
      const buffer = await studentImportTemplate(user);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="student-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent('学生导入模板.xlsx')}`,
          'Cache-Control': 'no-store',
        },
      });
    }
    if (path.length === 3 && path[0] === 'students' && path[2] === 'delete' && write) {
      teacherOnly(user);
      await deleteStudent(user, path[1], await readJson(req));
      return json({ ok: true });
    }
    if (path.length === 3 && path[0] === 'students' && path[2] === 'transfer' && write) {
      teacherOnly(user);
      return json(await transferStudent(user, path[1], await readJson(req)));
    }
    if (path.length === 3 && path[0] === 'students' && path[2] === 'identity' && write) {
      teacherOnly(user);
      return json(await setStudentIdentity(user, path[1], await readJson(req)));
    }
    if (key === 'tasks' && write) {
      if (!canPublishTasks(user)) throw new HttpError(403, '仅教师或学生干部可以创建任务');
      const input = taskSchema.parse(await readJson(req));
      if (new Date(input.deadline) <= new Date()) throw new HttpError(400, '截止时间必须晚于现在');
      if (!(await db.grade.findUnique({ where: { id: input.gradeId } })))
        throw new HttpError(400, '年级不存在');
      for (const f of input.fields)
        if (
          ['RADIO', 'CHECKBOX'].includes(f.type) &&
          (f.options.length < 2 || new Set(f.options).size !== f.options.length)
        )
          throw new HttpError(400, '选择题至少需要两个不重复的选项');
      const students = await db.user.findMany({
        where: {
          role: 'STUDENT',
          OR: [{ class: { gradeId: input.gradeId } }, { gradeId: input.gradeId }],
          ...(input.targetIds ? { id: { in: input.targetIds } } : {}),
        },
        select: { id: true },
      });
      if (
        !students.length ||
        (input.targetIds && students.length !== new Set(input.targetIds).size)
      )
        throw new HttpError(400, '请选择本年级的有效学生');
      const task = await writeTransaction(async (tx) => {
        if (!canPublishTasks(await activeActor(tx, user)))
          throw new HttpError(403, '当前身份不能发布任务');
        const managerIds = input.managerIds || [];
        if (managerIds.includes(user.id))
          throw new HttpError(400, '创建人自动拥有管理权限，无需重复选择');
        const managers = await tx.user.count({
          where: { id: { in: managerIds }, role: 'STUDENT', isStudentOfficer: true },
        });
        if (managers !== managerIds.length)
          throw new HttpError(400, '共同管理人必须是有效的学生干部，请刷新后重新选择');
        return tx.collectionTask.create({
          data: {
            title: input.title,
            description: input.description,
            deadline: new Date(input.deadline),
            gradeId: input.gradeId,
            creatorId: user.id,
            managers: { create: managerIds.map((userId) => ({ userId })) },
            allowEdit: input.allowEdit,
            officerCanView: input.officerCanView,
            targets: { create: students.map((s) => ({ userId: s.id })) },
            fields: {
              create: input.fields.map((f, position) => ({
                ...f,
                options: JSON.stringify(f.options),
                position,
              })),
            },
          },
        });
      });
      return json({ id: task.id });
    }
    if (path[0] === 'tasks' && path[1]) {
      const taskId = path[1];
      const action = path[2];
      if (action === 'delete' && path.length === 3 && write) {
        const { confirmTitle } = z
          .object({ confirmTitle: z.string().min(1).max(100) })
          .strict()
          .parse(await readJson(req));
        // 先删除提交（答案级联删除），再删除任务（字段和填写对象级联删除）。
        // 同一事务保证任一步失败时，任务与历史答案都不会被部分删除。
        await writeTransaction(async (tx) => {
          const active = await activeActor(tx, user);
          const task = await tx.collectionTask.findUnique({
            where: { id: taskId },
            include: { managers: true },
          });
          if (!task) throw new HttpError(404, '任务不存在或已被删除');
          if (!canManageTask(active, task)) throw new HttpError(403, '无权管理此任务');
          if (task.title !== confirmTitle) throw new HttpError(400, '任务名称不匹配，请重新核对');
          await tx.submission.deleteMany({ where: { taskId } });
          await tx.collectionTask.delete({ where: { id: taskId } });
        });
        return json({ ok: true });
      }
      if (action === 'status' && write) {
        const input = z
          .object({
            status: z.enum(['OPEN', 'CLOSED']),
            deadline: z.string().datetime({ offset: true }).optional(),
          })
          .parse(await readJson(req));
        // 状态检查和更新放在同一事务，避免并发发布覆盖手动截止。
        await writeTransaction(async (tx) => {
          const active = await activeActor(tx, user);
          const old = await tx.collectionTask.findUnique({
            where: { id: taskId },
            include: { managers: true },
          });
          if (!old) throw new HttpError(404, '任务不存在');
          if (!canManageTask(active, old)) throw new HttpError(403, '无权管理此任务');
          if (input.status === 'OPEN' && old.status !== 'DRAFT')
            throw new HttpError(400, '只有草稿可以发布');
          const deadline = input.deadline ? new Date(input.deadline) : old.deadline;
          if (input.status === 'OPEN' && deadline <= new Date())
            throw new HttpError(400, '请先设置未来的截止时间');
          await tx.collectionTask.update({
            where: { id: taskId },
            data: { status: input.status, deadline },
          });
        });
        return json({ ok: true });
      }
      if (action === 'deadline' && write) {
        const { deadline } = z
          .object({ deadline: z.string().datetime({ offset: true }) })
          .parse(await readJson(req));
        if (new Date(deadline) <= new Date()) throw new HttpError(400, '截止时间必须晚于现在');
        const updated = await writeTransaction(async (tx) => {
          const active = await activeActor(tx, user);
          const old = await tx.collectionTask.findUnique({
            where: { id: taskId },
            include: { managers: true },
          });
          if (!old) throw new HttpError(404, '任务不存在');
          if (!canManageTask(active, old)) throw new HttpError(403, '无权管理此任务');
          if (old.status === 'CLOSED') throw new HttpError(400, '手动结束的任务不能更改截止时间');
          return tx.collectionTask.update({
            where: { id: taskId },
            data: { deadline: new Date(deadline) },
          });
        });
        return json({ deadline: updated.deadline, displayStatus: taskStatus(updated) });
      }
      if ((action === 'report' || action === 'export') && !write) {
        const report = await taskReport(user, taskId, req.nextUrl.searchParams.get('classId'));
        if (action === 'report') return json(report);
        const book = new ExcelJS.Workbook();
        const sheet = book.addWorksheet('提交汇总');
        const fields = report.canView ? report.task.fields : [];
        sheet.addRow(['姓名', '学号', '班级', ...fields.map((f) => f.label), '提交时间']);
        for (const row of report.rows)
          sheet.addRow([
            row.name,
            row.studentNumber,
            row.class?.name || '暂未分班',
            ...fields.map((f) => {
              const answer = row.submission?.answers?.find((a) => a.fieldId === f.id);
              const value = answer ? JSON.parse(answer.value) : '';
              if (['FILE', 'PHOTO', 'SIGNATURE'].includes(f.type) && Array.isArray(value)) {
                const files = row.submission?.attachments || [];
                return value
                  .map((id) => {
                    const file = files.find((file) => file.id === id);
                    return file
                      ? `${file.name}: ${process.env.PUBLIC_ORIGIN || req.nextUrl.origin}${attachmentUrl(file.id)}`
                      : '';
                  })
                  .filter(Boolean)
                  .join('\n');
              }
              // ExcelJS 把字符串写成文本，不把用户输入解释为 Excel 公式。
              return Array.isArray(value) ? value.join('、') : String(value);
            }),
            row.submission
              ? row.submission.updatedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
              : '未提交',
          ]);
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B5B' } };
        sheet.columns.forEach((c) => {
          c.width = 24;
        });
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        return new NextResponse(new Uint8Array(await book.xlsx.writeBuffer()), {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(report.task.title + '.xlsx')}`,
            'Cache-Control': 'no-store',
          },
        });
      }
      const task = await accessibleTask(user, taskId);
      if (!action && !write) {
        const submission = await db.submission.findUnique({
          where: { taskId_userId: { taskId, userId: user.id } },
          include: { answers: true },
        });
        const attachments = submission
          ? await db.attachment.findMany({
              where: { taskId, userId: user.id },
              select: attachmentSelect,
            })
          : [];
        return json({
          task: { ...task, displayStatus: taskStatus(task) },
          submission: submission ? { ...submission, attachments } : null,
        });
      }
      if (action === 'submit' && write) {
        if (user.role !== 'STUDENT') throw new HttpError(403, '只有学生可以填写');
        const { key: requestKey, version } = submissionHeaders(req);
        const receiveStart = performance.now();
        const { raw, uploads } = await readSubmission(req, task.fields);
        const uploadBytes = uploads.reduce((sum, file) => sum + file.size, 0);
        if (uploadBytes) {
          traffic.rates.consume('upload-bytes:' + user.id, uploadBytes, 320 * 1024 * 1024, 3600000);
          traffic.rates.consume(
            'upload-bytes:global',
            uploadBytes,
            2 * 1024 * 1024 * 1024,
            3600000,
          );
        }
        const requestHash = requestKey ? submissionHash(raw, uploads) : '';
        const receiveMs = performance.now() - receiveStart;
        const saveStart = performance.now();
        const submission = await writeTransaction(
          async (tx) => {
            const active = await activeActor(tx, user);
            if (active.role !== 'STUDENT') throw new HttpError(403, '只有学生可以填写');
            if (requestKey) {
              const previous = await tx.submissionRequest.findUnique({
                where: { taskId_userId_key: { taskId, userId: user.id, key: requestKey } },
              });
              if (previous) {
                if (previous.requestHash !== requestHash)
                  throw new HttpError(409, '同一提交标识对应的内容已变化，请重新提交');
                return JSON.parse(previous.receipt) as { submittedAt: string; updatedAt: string };
              }
            }
            const existing = await assertSubmittable(tx, taskId, user.id);
            if (
              version !== null &&
              (existing ? version !== existing.updatedAt.toISOString() : version !== 'initial')
            )
              throw new HttpError(409, '此提交已在其他页面更新，请刷新核对后再修改');
            const { input, retained, toCreate } = await prepareAttachments(
              tx,
              taskId,
              user.id,
              task.fields,
              raw,
              uploads,
            );
            const answers = validateAnswers(task.fields, input);
            if (toCreate.length) await tx.attachment.createMany({ data: toCreate });
            if (existing)
              await tx.submissionAnswer.deleteMany({ where: { submissionId: existing.id } });
            const saved = await tx.submission.upsert({
              where: { taskId_userId: { taskId, userId: user.id } },
              create: { taskId, userId: user.id, answers: { create: answers } },
              update: {
                updatedAt: new Date(Math.max(Date.now(), (existing?.updatedAt.getTime() || 0) + 1)),
                answers: { create: answers },
              },
              select: { submittedAt: true, updatedAt: true },
            });
            if (task.fields.some((field) => ['FILE', 'PHOTO', 'SIGNATURE'].includes(field.type)))
              await tx.attachment.deleteMany({
                where: { taskId, userId: user.id, id: { notIn: retained } },
              });
            if (requestKey) {
              await tx.submissionRequest.deleteMany({
                where: {
                  createdAt: { lt: new Date(Date.now() - 7 * 86400000) },
                },
              });
              await tx.submissionRequest.create({
                data: {
                  taskId,
                  userId: user.id,
                  key: requestKey,
                  requestHash,
                  receipt: JSON.stringify(saved),
                },
              });
            }
            return saved;
          },
          { timeout: 15000 },
        );
        return json(
          { ok: true, submission },
          `receive;dur=${receiveMs.toFixed(1)}, save;dur=${(performance.now() - saveStart).toFixed(1)}`,
        );
      }
    }
    throw new HttpError(404, '接口不存在');
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json(
        { error: e.message },
        {
          status: e.status,
          headers: {
            'Cache-Control': 'no-store',
            ...(e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {}),
          },
        },
      );
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return NextResponse.json({ error: '输入格式不正确，请检查字段内容' }, { status: 400 });
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      ['P1008', 'P2024', 'P2028', 'P2034'].includes(e.code)
    )
      return NextResponse.json(
        { error: '当前提交较多，请稍后重试，填写内容仍保留' },
        { status: 503, headers: { 'Retry-After': '3', 'Cache-Control': 'no-store' } },
      );
    console.error(e);
    return NextResponse.json({ error: '服务器处理失败，请稍后重试' }, { status: 500 });
  } finally {
    for (const release of releases.reverse()) release();
  }
}
export const GET = handle;
export const POST = handle;
