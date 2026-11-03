import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin } from '../src/lib/request-origin';
const req = (origin?: string, extra = {}) =>
  new Request('http://localhost:3100/api/login', {
    headers: { host: '127.0.0.1:3100', ...(origin ? { origin } : {}), ...extra },
  });
test('公网 HTTPS 来源可以通过本机 HTTP 反向代理；其他来源不能伪造转发头绕过', () => {
  const publicOrigin = 'https://school.example.com';
  assert.equal(isAllowedOrigin(req(publicOrigin), publicOrigin), true);
  for (const origin of [
    undefined,
    'null',
    'https://evil.example',
    'https://school.example.com.evil.example',
    publicOrigin + '/path',
    'http://school.example.com',
  ]) {
    assert.equal(
      isAllowedOrigin(
        req(origin, { 'x-forwarded-host': 'school.example.com', 'x-forwarded-proto': 'https' }),
        publicOrigin,
      ),
      false,
    );
  }
  assert.equal(isAllowedOrigin(req('http://127.0.0.1:3100')), true);
  assert.equal(isAllowedOrigin(req('https://127.0.0.1:3100')), false);
});
