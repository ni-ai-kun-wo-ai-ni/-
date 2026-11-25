import test from 'node:test';
import assert from 'node:assert/strict';
import { ConcurrencyGate, RateLimiter, sourceKey } from '../src/lib/traffic-guard';
import { HttpError } from '../src/lib/http-error';
import { readJson, parseJsonText, MAX_JSON_BYTES } from '../src/lib/request-body';
import { submissionHash } from '../src/lib/submission-request';

test('限流：独立账号、窗口过期、容量耗尽不清空旧计数及上传字节配额', () => {
  const rates = new RateLimiter(2);
  rates.check('a', 2, 1000, 0);
  rates.check('a', 2, 1000, 0);
  assert.throws(
    () => rates.check('a', 2, 1000, 1),
    (e) => e instanceof HttpError && e.status === 429 && e.retryAfter === 1,
  );
  rates.check('b', 2, 1000, 0);
  assert.throws(
    () => rates.check('c', 2, 1000, 1),
    (e) => e instanceof HttpError && e.status === 503,
  );
  assert.throws(() => rates.check('a', 2, 1000, 1));
  rates.check('c', 2, 1000, 1001);
  rates.consume('bytes', 80, 100, 1000, 1001);
  assert.throws(() => rates.consume('bytes', 30, 100, 1000, 1001));
});
test('并发队列：有限排队、过载拒绝、出错也释放、超时不遗留占位', async () => {
  const gate = new ConcurrencyGate(1, 1, 30);
  const release = await gate.acquire();
  const queued = gate.acquire();
  await assert.rejects(gate.acquire(), (e) => e instanceof HttpError && e.status === 503);
  release();
  release();
  const nextRelease = await queued;
  await assert.rejects(gate.acquire(), /超时/);
  nextRelease();
  await assert.rejects(
    gate.run(async () => {
      throw new Error('失败');
    }),
    /失败/,
  );
  assert.equal(await gate.run(async () => 42), 42);
});
test('JSON：支持正常请求，拒绝伪造长度、无长度超限、嵌套攻击和错误格式', async () => {
  assert.deepEqual(
    await readJson(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"a":1}',
      }),
    ),
    { a: 1 },
  );
  await assert.rejects(
    readJson(new Request('http://localhost', { method: 'POST', body: '{}' })),
    (e) => e instanceof HttpError && e.status === 415,
  );
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readJson(
      new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
        body,
        duplex: 'half',
      } as RequestInit),
    ),
    (e) => e instanceof HttpError && e.status === 413,
  );
  assert.equal(cancelled, true);
  assert.throws(() => parseJsonText('['.repeat(22) + '0' + ']'.repeat(22)), /复杂/);
  assert.throws(() => parseJsonText('x'.repeat(MAX_JSON_BYTES + 1)), /过大/);
  assert.throws(() => parseJsonText('{bad'), SyntaxError);
});
test('提交内容摘要包含真实附件字节，JSON键顺序不影响重试；默认不信任代理IP', () => {
  assert.equal(submissionHash({ a: 1, b: 2 }, []), submissionHash({ b: 2, a: 1 }, []));
  const file = { fieldId: 'f', name: 'a.txt', data: Buffer.from('a') };
  assert.notEqual(
    submissionHash({}, [file]),
    submissionHash({}, [{ ...file, data: Buffer.from('b') }]),
  );
  const old = process.env.TRUST_CLOUDFLARE_IP;
  try {
    delete process.env.TRUST_CLOUDFLARE_IP;
    assert.equal(
      sourceKey(
        new Request('http://localhost', {
          headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' },
        }),
      ),
      'shared',
    );
  } finally {
    if (old === undefined) delete process.env.TRUST_CLOUDFLARE_IP;
    else process.env.TRUST_CLOUDFLARE_IP = old;
  }
});
