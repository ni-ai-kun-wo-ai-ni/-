import { createHash } from 'node:crypto';
import { HttpError } from './http-error';
export function submissionHeaders(request: Request) {
  const key = request.headers.get('idempotency-key');
  const version = request.headers.get('x-submission-version');
  if (key !== null && !/^[A-Za-z0-9_-]{8,128}$/.test(key))
    throw new HttpError(400, '提交请求标识不正确');
  if (
    version !== null &&
    version !== 'initial' &&
    (version.length > 40 || !Number.isFinite(Date.parse(version)))
  )
    throw new HttpError(400, '提交版本不正确，请刷新页面');
  return { key, version };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function submissionHash(
  raw: unknown,
  uploads: { fieldId: string; name: string; data: Uint8Array }[],
) {
  const hash = createHash('sha256').update(JSON.stringify(canonical(raw)));
  for (const file of uploads)
    hash.update(JSON.stringify([file.fieldId, file.name, file.data.byteLength])).update(file.data);
  return hash.digest('hex');
}
