import { HttpError } from './http-error';
export const MAX_JSON_BYTES = 256 * 1024;
export async function readJson(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new HttpError(415, '请使用 JSON 格式提交');
  if (Number(request.headers.get('content-length')) > MAX_JSON_BYTES)
    throw new HttpError(413, '提交内容过大，请减少文字内容');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '提交内容不能为空');
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 30000);
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_JSON_BYTES) throw new HttpError(413, '提交内容过大，请减少文字内容');
      chunks.push(part.value);
    }
    if (timedOut) throw new HttpError(408, '接收请求超时，请检查网络后重试');
    return parseJsonText(Buffer.concat(chunks).toString('utf8'));
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function parseJsonText(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) throw new HttpError(413, '提交内容过大');
  const result: unknown = JSON.parse(text);
  const pending = [{ value: result, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++nodes > 20000 || depth > 20) throw new HttpError(400, '提交内容结构过于复杂');
    if (value && typeof value === 'object')
      for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
  return result;
}
