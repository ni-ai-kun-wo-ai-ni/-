import { hash } from 'bcryptjs';
import { z } from 'zod';
import { db } from './db';
import { HttpError } from './auth';

const schema = z
  .object({
    password: z
      .string()
      .min(8)
      .max(72)
      .refine(
        (value) =>
          Buffer.byteLength(value, 'utf8') <= 72 && /[A-Za-z]/.test(value) && /[0-9]/.test(value),
        '密码需包含字母和数字，且不超过72字节',
      )
      .refine((value) => !['123456', 'Demo2026!'].includes(value), '请使用自己的新密码'),
    confirmPassword: z.string(),
  })
  .strict()
  .refine((input) => input.password === input.confirmPassword, '两次密码输入不一致');

export async function completeInitialPassword(userId: string, raw: unknown) {
  const input = schema.parse(raw);
  const passwordHash = await hash(input.password, 12);
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'STUDENT' || !user.mustChangePassword)
      throw new HttpError(409, '该账号已设置过密码，请使用新密码重新登录');
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    // 所有使用初始密码建立的会话失效，包括同时在其他设备登录的会话。
    await tx.session.deleteMany({ where: { userId } });
  });
}
