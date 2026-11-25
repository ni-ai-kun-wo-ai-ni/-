import { Prisma, type User } from '@prisma/client';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { db, writeTransaction } from './db';
import { HttpError, superAdminOnly } from './auth';
import { activeActor } from './auth';

const teacherSelect = {
  id: true,
  username: true,
  name: true,
  isSuperAdmin: true,
  mustChangePassword: true,
} as const;

export async function listTeachers(actor: User) {
  superAdminOnly(actor);
  return db.user.findMany({
    where: { role: 'TEACHER' },
    select: teacherSelect,
    orderBy: { username: 'asc' },
  });
}

export async function createTeacher(actor: User, raw: unknown) {
  superAdminOnly(actor);
  const input = z
    .object({
      name: z.string().trim().min(1).max(60),
      username: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{3,60}$/),
    })
    .strict()
    .parse(raw);
  const initialPassword = '123456';
  const passwordHash = await hash(initialPassword, 12);
  try {
    const teacher = await writeTransaction(async (tx) => {
      const active = await activeActor(tx, actor);
      superAdminOnly(active);
      const current = await tx.user.findUnique({ where: { id: actor.id } });
      if (!current) throw new HttpError(401, '请重新登录');
      superAdminOnly(current);
      return tx.user.create({
        data: {
          ...input,
          role: 'TEACHER',
          isSuperAdmin: false,
          passwordHash,
          mustChangePassword: true,
        },
        select: teacherSelect,
      });
    });
    return { teacher, initialPassword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new HttpError(409, '登录账号已存在，请更换账号');
    throw error;
  }
}

export async function deleteTeacher(actor: User, id: string, raw: unknown) {
  superAdminOnly(actor);
  const { confirmUsername } = z
    .object({ confirmUsername: z.string().min(1).max(60) })
    .strict()
    .parse(raw);
  await writeTransaction(async (tx) => {
    const active = await activeActor(tx, actor);
    superAdminOnly(active);
    const current = await tx.user.findUnique({ where: { id: actor.id } });
    if (!current) throw new HttpError(401, '请重新登录');
    superAdminOnly(current);
    const teacher = await tx.user.findUnique({ where: { id } });
    if (!teacher) throw new HttpError(404, '教师账号不存在或已被删除');
    if (teacher.role !== 'TEACHER') throw new HttpError(403, '此入口只能删除教师账号');
    if (id === actor.id || teacher.isSuperAdmin)
      throw new HttpError(403, '不能删除自己或超级管理员账号');
    if (teacher.username !== confirmUsername)
      throw new HttpError(400, '确认账号不匹配，请重新核对');
    await tx.collectionTask.updateMany({ where: { creatorId: id }, data: { creatorId: actor.id } });
    // 保留任务、学生和全部填写结果，登录会话随账号级联删除。
    await tx.user.delete({ where: { id } });
  });
}

export async function updateTeacher(actor: User, id: string, raw: unknown) {
  superAdminOnly(actor);
  const input = z
    .object({
      name: z.string().trim().min(1).max(60),
      username: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{3,60}$/),
      password: z
        .string()
        .min(8)
        .max(72)
        .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, '密码不能超过72字节')
        .optional(),
    })
    .strict()
    .parse(raw);
  const passwordHash = input.password === undefined ? undefined : await hash(input.password, 12);
  try {
    return await writeTransaction(async (tx) => {
      const active = await activeActor(tx, actor);
      superAdminOnly(active);
      const current = await tx.user.findUnique({ where: { id: actor.id } });
      if (!current) throw new HttpError(401, '请重新登录');
      superAdminOnly(current);
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw new HttpError(404, '教师账号不存在或已被删除');
      if (target.role !== 'TEACHER') throw new HttpError(403, '此入口只能修改教师账号');
      if (target.isSuperAdmin && target.id !== actor.id)
        throw new HttpError(403, '只能修改自己的超级管理员账号');
      const credentialsChanged = input.username !== target.username || passwordHash !== undefined;
      const teacher = await tx.user.update({
        where: { id },
        data: {
          name: input.name,
          username: input.username,
          ...(passwordHash === undefined
            ? {}
            : { passwordHash, mustChangePassword: !target.isSuperAdmin }),
        },
        select: teacherSelect,
      });
      if (credentialsChanged) await tx.session.deleteMany({ where: { userId: id } });
      return { teacher, reauthenticate: id === actor.id && credentialsChanged };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new HttpError(409, '登录账号已存在，请更换账号');
    throw error;
  }
}
