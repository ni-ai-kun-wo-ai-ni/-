import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSubmission, type UploadProgress } from '../src/lib/submission-client';

class FakeRequest {
  static latest: FakeRequest;
  upload = {
    onprogress: null as
      ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null,
    onload: null as (() => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  status = 200;
  responseText = '';
  headers: Record<string, string> = {};
  body: unknown;
  constructor() {
    FakeRequest.latest = this;
  }
  open() {}
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
}

test('上传进度和保存确认：100%不提前成功，失败保留可重试的文件', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    writable: true,
    value: FakeRequest,
  });
  const receipt = {
    submittedAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
  };
  try {
    await t.test('真实发送进度可显示百分比；上传完成后继续等待服务器保存回执', async () => {
      const states: UploadProgress[] = [],
        form = new FormData();
      form.set('answers', '{}');
      let completed = false;
      const pending = sendSubmission('task', form, (state) => states.push(state), {
        key: 'retry-intent',
        version: 'initial',
      }).then((result) => {
        completed = true;
        return result;
      });
      const request = FakeRequest.latest;
      assert.equal(request.headers['Idempotency-Key'], 'retry-intent');
      assert.equal(request.headers['X-Submission-Version'], 'initial');
      assert.equal(request.timeout, 180000);
      request.upload.onprogress!({ loaded: 5, total: 10, lengthComputable: true });
      assert.equal(states.at(-1)?.percent, 50);
      request.upload.onload!();
      await Promise.resolve();
      assert.equal(states.at(-1)?.phase, 'saving');
      assert.equal(completed, false);
      request.responseText = JSON.stringify({ ok: true, submission: receipt });
      request.onload!();
      assert.deepEqual(await pending, receipt);
      assert.equal(completed, true);
    });
    await t.test('网络中断和服务端拒绝均返回错误，不改写原FormData或移除文件', async () => {
      const form = new FormData();
      const file = new File(['content'], '原文件.txt');
      form.set('files:field', file);
      const failed = sendSubmission('task', form, () => {});
      FakeRequest.latest.onerror!();
      await assert.rejects(failed, /连接中断/);
      assert.equal(form.get('files:field'), file);
      const timedOut = sendSubmission('task', form, () => {});
      FakeRequest.latest.ontimeout!();
      await assert.rejects(timedOut, /超时/);
      const rejected = sendSubmission('task', {}, () => {});
      const request = FakeRequest.latest;
      request.status = 403;
      request.responseText = JSON.stringify({ error: '此任务不允许修改提交' });
      request.onload!();
      await assert.rejects(rejected, /不允许修改/);
    });
    await t.test(
      'JSON提交不假显示附件百分比，空回执、无效JSON和缺失时间均不能冒充成功',
      async () => {
        for (const responseText of [
          'null',
          '<html>bad gateway</html>',
          JSON.stringify({ ok: true }),
          JSON.stringify({ ok: true, submission: { ...receipt, updatedAt: 'invalid' } }),
        ]) {
          const states: UploadProgress[] = [];
          const pending = sendSubmission('task', { field: '文字' }, (state) => states.push(state));
          const request = FakeRequest.latest;
          request.upload.onprogress!({ loaded: 5, total: 10, lengthComputable: true });
          assert.equal(states.length, 0);
          assert.equal(request.headers['Content-Type'], 'application/json');
          request.responseText = responseText;
          request.onload!();
          await assert.rejects(pending, /保存/);
        }
      },
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, 'XMLHttpRequest', previous);
    else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
  }
});
