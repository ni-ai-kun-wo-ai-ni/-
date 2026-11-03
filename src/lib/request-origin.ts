// 公网反向代理在外侧使用 HTTPS、在本机使用 HTTP。
// 只信任管理员显式配置的公网来源，不能直接信任任意 X-Forwarded-* 请求头。
export function isAllowedOrigin(request: Request, publicOrigin?: string): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    if (publicOrigin) return origin === new URL(publicOrigin).origin;
    const host = request.headers.get('host');
    return !!host && parsed.host === host && parsed.protocol === new URL(request.url).protocol;
  } catch {
    return false;
  }
}
