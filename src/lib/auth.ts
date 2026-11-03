import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';
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
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('hex');
  await db.session.create({
    data: { id: tokenHash(token), userId, expiresAt: new Date(Date.now() + 7 * 86400000) },
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
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  // Next.js 内部可能把 127.0.0.1 归一化为 localhost，因此与浏览器实际 Host 比较。
  if (
    !origin ||
    !host ||
    new URL(origin).host !== host ||
    new URL(origin).protocol !== new URL(request.url).protocol
  )
    throw new HttpError(403, '请求来源不合法');
}
