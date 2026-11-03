import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { db } from '@/lib/db';
import {
  checkOrigin,
  createSession,
  currentUser,
  HttpError,
  teacherOnly,
  tokenHash,
} from '@/lib/auth';
import { accessibleTask, isOpen, publicUser, taskReport, taskStatus } from '@/lib/access';
import { taskSchema, validateAnswers } from '@/lib/validation';
import { createStudent, deleteStudent } from '@/lib/students';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const json = (data: unknown) =>
  NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
// 本地 MVP 的登录限速；重启会清空，不代替生产环境限速。
const attempts = new Map<string, { count: number; until: number }>();
async function handle(req: NextRequest, ctx: Context) {
  try {
    const { path } = await ctx.params;
    const key = path.join('/');
    const write = req.method === 'POST';
    if (write) checkOrigin(req);
    if (key === 'login' && write) {
      const input = z
        .object({
          username: z.string().trim().min(1).max(60),
          password: z.string().min(1).max(100),
        })
        .parse(await req.json());
      const attempt = attempts.get(input.username);
      if (attempt && attempt.until > Date.now() && attempt.count >= 10)
        throw new HttpError(429, '尝试次数过多，请 15 分钟后重试');
      const user = await db.user.findUnique({ where: { username: input.username } });
      if (
        !user ||
        (process.env.PUBLIC_MODE === 'true' && input.password === 'Demo2026!') ||
        !(await compare(input.password, user.passwordHash))
      ) {
        const old = attempt && attempt.until > Date.now() ? attempt.count : 0;
        if (attempts.size > 5000) attempts.clear();
        attempts.set(input.username, { count: old + 1, until: Date.now() + 900000 });
        throw new HttpError(401, '账号或密码错误');
      }
      attempts.delete(input.username);
      await createSession(user.id);
      return json({ ok: true });
    }
    const user = await currentUser();
    if (key === 'logout' && write) {
      const jar = await cookies();
      const token = jar.get('grade_session')?.value;
      if (token) await db.session.deleteMany({ where: { id: tokenHash(token) } });
      jar.delete('grade_session');
      return json({ ok: true });
    }
    if (key === 'bootstrap' && !write) {
      const me = await db.user.findUnique({ where: { id: user.id }, select: publicUser });
      const tasks = await db.collectionTask.findMany({
        where:
          user.role === 'TEACHER'
            ? {}
            : { status: { not: 'DRAFT' }, targets: { some: { userId: user.id } } },
        include: {
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
            orderBy: { createdAt: 'desc' },
          })
        : [];
      const grades =
        user.role === 'TEACHER'
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
        tasks: tasks.map((t) => ({ ...t, displayStatus: taskStatus(t) })),
        officerTasks: officerTasks.map((t) => ({ ...t, displayStatus: taskStatus(t) })),
        grades,
        students,
      });
    }
    if (key === 'students' && write) {
      teacherOnly(user);
      return json(await createStudent(user, await req.json()));
    }
    if (path.length === 3 && path[0] === 'students' && path[2] === 'delete' && write) {
      teacherOnly(user);
      await deleteStudent(user, path[1], await req.json());
      return json({ ok: true });
    }
    if (key === 'tasks' && write) {
      teacherOnly(user);
      const input = taskSchema.parse(await req.json());
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
          class: { gradeId: input.gradeId },
          ...(input.targetIds ? { id: { in: input.targetIds } } : {}),
        },
        select: { id: true },
      });
      if (
        !students.length ||
        (input.targetIds && students.length !== new Set(input.targetIds).size)
      )
        throw new HttpError(400, '请选择本年级的有效学生');
      const task = await db.collectionTask.create({
        data: {
          title: input.title,
          description: input.description,
          deadline: new Date(input.deadline),
          gradeId: input.gradeId,
          creatorId: user.id,
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
      return json({ id: task.id });
    }
    if (path[0] === 'tasks' && path[1]) {
      const taskId = path[1];
      const action = path[2];
      if (action === 'status' && write) {
        teacherOnly(user);
        const input = z
          .object({
            status: z.enum(['OPEN', 'CLOSED']),
            deadline: z.string().datetime({ offset: true }).optional(),
          })
          .parse(await req.json());
        // 状态检查和更新放在同一事务，避免并发发布覆盖手动截止。
        await db.$transaction(async (tx) => {
          const old = await tx.collectionTask.findUnique({ where: { id: taskId } });
          if (!old) throw new HttpError(404, '任务不存在');
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
        teacherOnly(user);
        const { deadline } = z
          .object({ deadline: z.string().datetime({ offset: true }) })
          .parse(await req.json());
        if (new Date(deadline) <= new Date()) throw new HttpError(400, '截止时间必须晚于现在');
        const old = await accessibleTask(user, taskId);
        if (old.status === 'CLOSED') throw new HttpError(400, '手动结束的任务不能更改截止时间');
        await db.collectionTask.update({
          where: { id: taskId },
          data: { deadline: new Date(deadline) },
        });
        return json({ ok: true });
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
            row.class?.name,
            ...fields.map((f) => {
              const answer = row.submission?.answers?.find((a) => a.fieldId === f.id);
              const value = answer ? JSON.parse(answer.value) : '';
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
        return json({ task: { ...task, displayStatus: taskStatus(task) }, submission });
      }
      if (action === 'submit' && write) {
        if (user.role !== 'STUDENT') throw new HttpError(403, '只有学生可以填写');
        const answers = validateAnswers(task.fields, await req.json());
        await db.$transaction(async (tx) => {
          const fresh = await tx.collectionTask.findUniqueOrThrow({ where: { id: taskId } });
          if (!isOpen(fresh)) throw new HttpError(400, '任务未开放或已截止');
          const existing = await tx.submission.findUnique({
            where: { taskId_userId: { taskId, userId: user.id } },
          });
          if (existing && !fresh.allowEdit) throw new HttpError(403, '此任务不允许修改提交');
          if (existing)
            await tx.submissionAnswer.deleteMany({ where: { submissionId: existing.id } });
          await tx.submission.upsert({
            where: { taskId_userId: { taskId, userId: user.id } },
            create: { taskId, userId: user.id, answers: { create: answers } },
            update: { updatedAt: new Date(), answers: { create: answers } },
          });
        });
        return json({ ok: true });
      }
    }
    throw new HttpError(404, '接口不存在');
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return NextResponse.json({ error: '输入格式不正确，请检查字段内容' }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: '服务器处理失败，请稍后重试' }, { status: 500 });
  }
}
export const GET = handle;
export const POST = handle;
