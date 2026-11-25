import { compare, hash } from 'bcryptjs';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { activeActor, HttpError } from './auth';
import { writeTransaction } from './db';

const schema = z
  .object({
    oldPassword: z
      .string()
      .min(1)
      .max(72)
      .refine((v) => Buffer.byteLength(v, 'utf8') <= 72),
    password: z
      .string()
      .min(8)
      .max(72)
      .refine(
        (v) => Buffer.byteLength(v, 'utf8') <= 72 && /[A-Za-z]/.test(v) && /[0-9]/.test(v),
        '新密码需包含字母和数字，且不超过72字节',
      )
      .refine((v) => !['123456', 'Demo2026!'].includes(v), '请使用安全的新密码'),
    confirmPassword: z.string(),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, '两次密码输入不一致')
  .refine((v) => v.password !== v.oldPassword, '新密码应与原密码不同');

export async function changeOwnPassword(actor: User, raw: unknown) {
  const input = schema.parse(raw);
  if (!(await compare(input.oldPassword, actor.passwordHash)))
    throw new HttpError(400, '原密码不正确');
  const passwordHash = await hash(input.password, 12);
  return writeTransaction(async (tx) => {
    const current = await activeActor(tx, actor);
    if (current.passwordHash !== actor.passwordHash)
      throw new HttpError(401, '密码已在其他页面修改，请重新登录');
    const updated = await tx.user.update({ where: { id: actor.id }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: actor.id } });
    return updated;
  });
}
