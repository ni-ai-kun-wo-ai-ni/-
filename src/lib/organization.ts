import { Prisma, type User } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { HttpError, teacherOnly } from './auth';
const name = z.string().trim().min(1).max(60);
const gradeSchema = z.object({ name }).strict();
const classSchema = z.object({ name, gradeId: z.string().min(1) }).strict();
const deleteSchema = z.object({ confirmName: z.string().min(1).max(60) }).strict();

export async function createGrade(actor: User, raw: unknown) {
  teacherOnly(actor);
  const input = gradeSchema.parse(raw);
  try {
    return await db.grade.create({ data: input, select: { id: true, name: true } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new HttpError(409, '该年级名称已存在');
    throw error;
  }
}
export async function createClass(actor: User, raw: unknown) {
  teacherOnly(actor);
  const input = classSchema.parse(raw);
  try {
    return await db.$transaction(async (tx) => {
      if (!(await tx.grade.findUnique({ where: { id: input.gradeId } })))
        throw new HttpError(400, '请选择有效的所属年级');
      return tx.class.create({ data: input, select: { id: true, name: true, gradeId: true } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new HttpError(409, '该年级中已存在同名班级');
    throw error;
  }
}

export async function deleteOrganization(
  actor: User,
  kind: 'grade' | 'class',
  id: string,
  raw: unknown,
) {
  teacherOnly(actor);
  const { confirmName } = deleteSchema.parse(raw);
  try {
    // 检查关联数据和删除放在同一个事务中；不级联删除学生、任务或提交。
    await db.$transaction(async (tx) => {
      if (kind === 'class') {
        const cls = await tx.class.findUnique({
          where: { id },
          include: { _count: { select: { students: true } } },
        });
        if (!cls) throw new HttpError(404, '班级不存在或已被删除');
        if (confirmName !== cls.name) throw new HttpError(400, '请输入完整班级名称确认删除');
        if (cls._count.students)
          throw new HttpError(
            409,
            `该班级还有 ${cls._count.students} 个账号，请先转班或删除学生账号`,
          );
        await tx.class.delete({ where: { id } });
      } else {
        const grade = await tx.grade.findUnique({
          where: { id },
          include: { _count: { select: { classes: true, tasks: true } } },
        });
        if (!grade) throw new HttpError(404, '年级不存在或已被删除');
        if (confirmName !== grade.name) throw new HttpError(400, '请输入完整年级名称确认删除');
        if (grade._count.classes || grade._count.tasks)
          throw new HttpError(
            409,
            `该年级还有 ${grade._count.classes} 个班级、${grade._count.tasks} 个任务，请先处理并删除这些班级和任务`,
          );
        await tx.grade.delete({ where: { id } });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003' || error.code === 'P2034')
        throw new HttpError(409, '关联数据已变化，请刷新页面，处理关联数据后重试');
      if (error.code === 'P2025') throw new HttpError(404, '记录不存在或已被删除');
    }
    throw error;
  }
}
