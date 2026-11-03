import type { User } from '@prisma/client';
import { db } from './db';
import { HttpError } from './auth';
export const publicUser = {
  id: true,
  username: true,
  name: true,
  studentNumber: true,
  classId: true,
  role: true,
  isClassOfficer: true,
  class: { select: { id: true, name: true, gradeId: true } },
} as const;
export const isOpen = (task: { status: string; deadline: Date }) =>
  task.status === 'OPEN' && task.deadline > new Date();
export const taskStatus = (task: { status: string; deadline: Date }) =>
  task.status === 'DRAFT' ? '草稿' : isOpen(task) ? '收集中' : '已截止';
export async function accessibleTask(user: User, id: string) {
  const task = await db.collectionTask.findUnique({
    where: { id },
    include: { fields: { orderBy: { position: 'asc' } } },
  });
  if (!task) throw new HttpError(404, '任务不存在');
  if (user.role !== 'TEACHER') {
    const target = await db.taskTarget.findUnique({
      where: { taskId_userId: { taskId: id, userId: user.id } },
    });
    if (task.status === 'DRAFT' || !target) throw new HttpError(403, '无权访问此任务');
  }
  return task;
}
// 统计和导出共用同一查询；班干部的 classId 永远取自 Session 用户，不能由前端扩大范围。
export async function taskReport(user: User, taskId: string, requestedClass?: string | null) {
  if (user.role !== 'TEACHER' && (!user.isClassOfficer || !user.classId))
    throw new HttpError(403, '无权查看统计');
  if (user.role !== 'TEACHER' && requestedClass && requestedClass !== user.classId)
    throw new HttpError(403, '不能查看其他班级');
  const task = await db.collectionTask.findUnique({
    where: { id: taskId },
    include: { fields: { orderBy: { position: 'asc' } }, targets: true },
  });
  if (!task) throw new HttpError(404, '任务不存在');
  if (user.role !== 'TEACHER' && task.status === 'DRAFT') throw new HttpError(403, '任务尚未发布');
  const classId = user.role === 'TEACHER' ? requestedClass || undefined : user.classId!;
  const students = await db.user.findMany({
    where: { role: 'STUDENT', id: { in: task.targets.map((t) => t.userId) }, classId },
    select: publicUser,
    orderBy: { studentNumber: 'asc' },
  });
  if (user.role !== 'TEACHER' && !students.length) throw new HttpError(403, '此任务未指定本班学生');
  const canView = user.role === 'TEACHER' || task.officerCanView;
  const submissions = await db.submission.findMany({
    where: { taskId, userId: { in: students.map((s) => s.id) } },
    include: { answers: canView },
  });
  const rows = students.map((s) => ({
    ...s,
    submission: submissions.find((sub) => sub.userId === s.id) ?? null,
  }));
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
