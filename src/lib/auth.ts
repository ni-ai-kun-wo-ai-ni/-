import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { db, writeTransaction } from './db';
import { isAllowedOrigin } from './request-origin';
import { HttpError } from './http-error';
import type { Prisma, User } from '@prisma/client';
export { HttpError } from './http-error';
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function currentUser() {
  const token = (await cookies()).get('grade_session')?.value;
  if (!token) throw new HttpError(401, '请先登录');
  const session = await db.session.findUnique({
    where: { id: tokenHash(token) },
    include: { user: { include: { class: true } } },
  });
  if (!session || session.expiresAt < new Date())
    throw new HttpError(401, '登录已过期，请重新登录');
  return { ...session.user, sessionId: session.id };
}
// 排队、解析上传或密码计算结束后，写事务内重新校验会话与当前身份。
export async function activeActor(
  tx: Prisma.TransactionClient,
  actor: User & { sessionId?: string },
) {
  const current = await tx.user.findUnique({ where: { id: actor.id } });
  if (!current) throw new HttpError(401, '账号已失效，请重新登录');
  if (actor.sessionId) {
    const session = await tx.session.findUnique({ where: { id: actor.sessionId } });
    if (!session || session.userId !== actor.id || session.expiresAt <= new Date())
      throw new HttpError(401, '登录状态已变化，请重新登录');
  }
  if (current.mustChangePassword) throw new HttpError(403, '请先设置自己的密码');
  return current;
}
export async function createSession(
  userId: string,
  expectedPasswordHash?: string,
  expectedUsername?: string,
) {
  const token = randomBytes(32).toString('hex');
  await writeTransaction(async (tx) => {
    // 防止旧密码登录与首次改密并发时，在改密完成后又创建一个旧凭据会话。
    if (
      expectedPasswordHash &&
      !(await tx.user.findFirst({
        where: {
          id: userId,
          passwordHash: expectedPasswordHash,
          ...(expectedUsername ? { username: expectedUsername } : {}),
        },
      }))
    )
      throw new HttpError(401, '账号或密码已变化，请使用新信息登录');
    await tx.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await tx.session.create({
      data: { id: tokenHash(token), userId, expiresAt: new Date(Date.now() + 7 * 86400000) },
    });
  });
  (await cookies()).set('grade_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 7 * 86400,
  });
}
export function teacherOnly(user: { role: string }) {
  if (user.role !== 'TEACHER') throw new HttpError(403, '仅教师可以操作');
}
export function superAdminOnly(user: { role: string; isSuperAdmin: boolean }) {
  if (user.role !== 'TEACHER' || !user.isSuperAdmin)
    throw new HttpError(403, '仅超级管理员可以管理教师账号');
}
// 对写操作验证同源，Cookie 不接受来自其他站点的请求。
export function checkOrigin(request: Request) {
  if (!isAllowedOrigin(request, process.env.PUBLIC_ORIGIN))
    throw new HttpError(403, '请求来源不合法');
}
