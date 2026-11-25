import type { User } from '@prisma/client';
import { db } from './db';
import { HttpError } from './auth';
import { attachmentSelect } from './attachment-types';
import { canManageTask } from './permissions';
import { UNASSIGNED_CLASS } from './report-filters';
export const publicUser = {
  id: true,
  username: true,
  name: true,
  studentNumber: true,
  classId: true,
  gradeId: true,
  grade: { select: { id: true, name: true } },
  role: true,
  isSuperAdmin: true,
  isClassOfficer: true,
  isStudentOfficer: true,
  mustChangePassword: true,
  class: { select: { id: true, name: true, gradeId: true } },
} as const;
export const reportStudent = {
  id: true,
  name: true,
  studentNumber: true,
  classId: true,
  gradeId: true,
  grade: publicUser.grade,
  class: publicUser.class,
} as const;
export const isOpen = (task: { status: string; deadline: Date }) =>
  task.status === 'OPEN' && task.deadline > new Date();
export const taskStatus = (task: { status: string; deadline: Date }) =>
  task.status === 'DRAFT' ? '草稿' : isOpen(task) ? '收集中' : '已截止';
export async function accessibleTask(user: User, id: string) {
  const task = await db.collectionTask.findUnique({
    where: { id },
    include: { managers: true, fields: { orderBy: { position: 'asc' } } },
  });
  if (!task) throw new HttpError(404, '任务不存在');
  if (!canManageTask(user, task)) {
    const target = await db.taskTarget.findUnique({
      where: { taskId_userId: { taskId: id, userId: user.id } },
    });
    if (task.status === 'DRAFT' || !target) throw new HttpError(403, '无权访问此任务');
  }
  return task;
}
// 统计和导出共用同一查询；班干部的 classId 永远取自 Session 用户，不能由前端扩大范围。
export async function taskReport(user: User, taskId: string, requestedClass?: string | null) {
  const task = await db.collectionTask.findUnique({
    where: { id: taskId },
    include: { managers: true, fields: { orderBy: { position: 'asc' } }, targets: true },
  });
  if (!task) throw new HttpError(404, '任务不存在');
  const manager = canManageTask(user, task);
  if (!manager && (!user.isClassOfficer || !user.classId)) throw new HttpError(403, '无权查看统计');
  if (!manager && requestedClass && requestedClass !== user.classId)
    throw new HttpError(403, '不能查看其他班级');
  if (!manager && task.status === 'DRAFT') throw new HttpError(403, '任务尚未发布');
  const classId = manager
    ? requestedClass === UNASSIGNED_CLASS
      ? null
      : requestedClass || undefined
    : user.classId!;
  const students = await db.user.findMany({
    where: { role: 'STUDENT', id: { in: task.targets.map((t) => t.userId) }, classId },
    select: reportStudent,
    orderBy: { studentNumber: 'asc' },
  });
  if (!manager && !students.length) throw new HttpError(403, '此任务未指定本班学生');
  const canView = manager || task.officerCanView;
  const submissions = await db.submission.findMany({
    where: { taskId, userId: { in: students.map((s) => s.id) } },
    include: { answers: canView },
  });
  const files = canView
    ? await db.attachment.findMany({
        where: { taskId, userId: { in: students.map((s) => s.id) } },
        select: { ...attachmentSelect, userId: true },
      })
    : [];
  const submissionByUser = new Map(
    submissions.map((submission) => [submission.userId, submission]),
  );
  const filesByUser = new Map<string, Omit<(typeof files)[number], 'userId'>[]>();
  for (const file of files) {
    const { userId, ...info } = file;
    const group = filesByUser.get(userId) || [];
    group.push(info);
    filesByUser.set(userId, group);
  }
  const rows = students.map((student) => {
    const submission = submissionByUser.get(student.id);
    return {
      ...student,
      submission: submission
        ? {
            ...submission,
            ...(canView
              ? {
                  attachments: filesByUser.get(student.id) || [],
                }
              : {}),
          }
        : null,
    };
  });
  const { targets: _targets, ...info } = task;
  void _targets;
  return {
    task: { ...info, displayStatus: taskStatus(task) },
    rows,
    canView,
    total: rows.length,
    submitted: submissions.length,
  };
}
