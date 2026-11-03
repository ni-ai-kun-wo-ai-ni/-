import { Prisma, type User } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { HttpError, teacherOnly } from './auth';
const name = z.string().trim().min(1).max(60);
const gradeSchema = z.object({ name }).strict();
const classSchema = z.object({ name, gradeId: z.string().min(1) }).strict();

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
