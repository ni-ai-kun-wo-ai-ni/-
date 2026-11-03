import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';
import { isAllowedOrigin } from './request-origin';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
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
  return session.user;
}
export async function createSession(userId: string, expectedPasswordHash?: string) {
  const token = randomBytes(32).toString('hex');
  await db.$transaction(async (tx) => {
    // 防止旧密码登录与首次改密并发时，在改密完成后又创建一个旧凭据会话。
    if (
      expectedPasswordHash &&
      !(await tx.user.findFirst({ where: { id: userId, passwordHash: expectedPasswordHash } }))
    )
      throw new HttpError(401, '密码已变化，请使用新密码登录');
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
// 对写操作验证同源，Cookie 不接受来自其他站点的请求。
export function checkOrigin(request: Request) {
  if (!isAllowedOrigin(request, process.env.PUBLIC_ORIGIN))
    throw new HttpError(403, '请求来源不合法');
}
