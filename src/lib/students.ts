import { Prisma, type User } from '@prisma/client';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { writeTransaction } from './db';
import { HttpError, teacherOnly } from './auth';
import { activeActor } from './auth';
import { publicUser } from './access';

const studentSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    studentNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,32}$/),
    classId: z
      .string()
      .trim()
      .nullish()
      .transform((value) => value || null),
    gradeId: z
      .string()
      .trim()
      .nullish()
      .transform((value) => value || null),
    isClassOfficer: z.boolean(),
    isStudentOfficer: z.boolean().default(false),
  })
  .strict();

export async function createStudent(actor: User, raw: unknown) {
  teacherOnly(actor);
  const input = studentSchema.parse(raw);
  const passwordHash = await hash('123456', 12);
  try {
    return await writeTransaction(async (tx) => {
      const active = await activeActor(tx, actor);
      teacherOnly(active);
      const cls = input.classId
        ? await tx.class.findUnique({ where: { id: input.classId } })
        : null;
      if (input.classId && !cls) throw new HttpError(400, '请选择有效的班级');
      if (input.gradeId && !(await tx.grade.findUnique({ where: { id: input.gradeId } })))
        throw new HttpError(400, '请选择有效的年级');
      if (cls && input.gradeId && cls.gradeId !== input.gradeId)
        throw new HttpError(400, '班级不属于所选年级');
      if (input.isClassOfficer && !cls) throw new HttpError(400, '请先分配班级，再设为班干部');
      // 身份固定为学生，绝不接受客户端传入教师 role。
      return tx.user.create({
        data: {
          ...input,
          gradeId: cls ? null : input.gradeId,
          username: input.studentNumber,
          role: 'STUDENT',
          passwordHash,
          mustChangePassword: true,
        },
        select: publicUser,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new HttpError(409, '登录账号或学号已存在，请修改后重试');
    throw error;
  }
}

export async function deleteStudent(actor: User, id: string, raw: unknown) {
  teacherOnly(actor);
  const { confirmUsername } = z
    .object({ confirmUsername: z.string().min(1).max(60) })
    .strict()
    .parse(raw);
  // 原子删除关联数据；教师账号不会进入此删除路径。
  await writeTransaction(async (tx) => {
    const active = await activeActor(tx, actor);
    teacherOnly(active);
    const student = await tx.user.findUnique({ where: { id } });
    if (!student) throw new HttpError(404, '学生账号不存在或已被删除');
    if (student.role !== 'STUDENT')
      throw new HttpError(403, '此操作只能删除学生账号，不能删除教师');
    if (student.username !== confirmUsername)
      throw new HttpError(400, '确认账号不匹配，请重新核对');
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.submission.deleteMany({ where: { userId: id } }); // 答案由外键级联删除。
    await tx.taskTarget.deleteMany({ where: { userId: id } });
    // 保留学生干部创建的任务和其他同学的答案，交由执行删除的教师管理。
    await tx.collectionTask.updateMany({ where: { creatorId: id }, data: { creatorId: actor.id } });
    await tx.user.delete({ where: { id } });
  });
}

export async function transferStudent(actor: User, id: string, raw: unknown) {
  teacherOnly(actor);
  const input = z
    .object({
      classId: z.string().min(1),
      fromClassId: z.string().nullable(),
      isClassOfficer: z.boolean(),
    })
    .strict()
    .parse(raw);
  return writeTransaction(async (tx) => {
    const active = await activeActor(tx, actor);
    teacherOnly(active);
    const student = await tx.user.findUnique({ where: { id } });
    if (!student) throw new HttpError(404, '学生账号不存在');
    if (student.role !== 'STUDENT') throw new HttpError(403, '只能为学生办理转班');
    if (student.classId !== input.fromClassId)
      throw new HttpError(409, '该学生所属班级已变化，请刷新后重新操作');
    if (student.classId === input.classId) throw new HttpError(400, '请选择与当前不同的班级');
    if (!(await tx.class.findUnique({ where: { id: input.classId } })))
      throw new HttpError(400, '目标班级不存在');
    // 只更新组织归属和教师确认的干部身份；账号、密码、任务及答案全部保留。
    // Session 每次请求重新查询 User，因此旧班管理权限不会缓存到登录凭据中。
    return tx.user.update({
      where: { id },
      data: { classId: input.classId, gradeId: null, isClassOfficer: input.isClassOfficer },
      select: publicUser,
    });
  });
}

export async function setStudentIdentity(actor: User, id: string, raw: unknown) {
  teacherOnly(actor);
  const input = z
    .object({
      isClassOfficer: z.boolean(),
      isStudentOfficer: z.boolean().optional(),
      fromClassId: z.string().nullable(),
    })
    .strict()
    .parse(raw);
  return writeTransaction(async (tx) => {
    const active = await activeActor(tx, actor);
    teacherOnly(active);
    const student = await tx.user.findUnique({ where: { id } });
    if (!student) throw new HttpError(404, '学生账号不存在');
    if (student.role !== 'STUDENT')
      throw new HttpError(403, '只能修改学生或班干部身份，不能修改教师');
    if (student.classId !== input.fromClassId)
      throw new HttpError(409, '学生所属班级已变化，请刷新后重新设置身份');
    if (input.isClassOfficer && !student.classId)
      throw new HttpError(400, '请先为学生分配班级，再设为班干部');
    // 班干部始终属于 STUDENT，仅修改干部标记。Session 下次请求会重新读取身份。
    return tx.user.update({
      where: { id },
      data: {
        isClassOfficer: input.isClassOfficer,
        ...(input.isStudentOfficer !== undefined
          ? { isStudentOfficer: input.isStudentOfficer }
          : {}),
      },
      select: publicUser,
    });
  });
}
