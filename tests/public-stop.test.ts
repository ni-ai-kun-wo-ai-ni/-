import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { stopPublic } from '../scripts/stop-public.mjs';

async function fixture() {
  const parent = resolve('.local');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'stop-test-'));
  await mkdir(join(root, '.local'));
  const statePath = join(root, '.local/public-server.json');
  const requestPath = join(root, '.local/stop-request.json');
  const messages: string[] = [];
  return {
    root,
    statePath,
    requestPath,
    messages,
    options: { root, timeoutMs: 150, pollMs: 10, log: (text: string) => messages.push(text) },
    cleanup: async () => {
      // 只删除本测试在项目 .local 中创建的临时目录。
      assert.equal(dirname(resolve(root)), parent);
      assert.ok(basename(root).startsWith('stop-test-'));
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function deadPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const pid = child.pid!;
  await once(child, 'exit');
  return pid;
}
async function listen() {
  const server = createServer((socket) => socket.end());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    port: address.port,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
const runId = () => randomBytes(16).toString('hex');
async function state(f: Awaited<ReturnType<typeof fixture>>, pid: number, port: number) {
  const record = { root: f.root, pid, port, runId: runId() };
  await writeFile(f.statePath, JSON.stringify(record));
  return record;
}

test('停止入口：进程和端口均已关闭时清理残留记录，不再误报超时', async () => {
  const f = await fixture();
  const net = await listen();
  await net.close();
  try {
    const record = await state(f, await deadPid(), net.port);
    await writeFile(f.requestPath, JSON.stringify({ pid: record.pid, runId: record.runId }));
    await stopPublic(f.options);
    assert.match(f.messages.join(), /网站已停止/);
    await assert.rejects(access(f.statePath));
    await assert.rejects(access(f.requestPath));
  } finally {
    await f.cleanup();
  }
});

test('停止入口：没有运行记录时重复停止正常返回', async () => {
  const f = await fixture();
  try {
    await stopPublic(f.options);
    assert.match(f.messages.join(), /无需重复停止/);
    await assert.rejects(access(f.requestPath));
  } finally {
    await f.cleanup();
  }
});

test('停止入口：管理进程和端口仍在运行时不能误报成功', async () => {
  const f = await fixture();
  const net = await listen();
  try {
    const record = await state(f, process.pid, net.port);
    await assert.rejects(stopPublic(f.options), /网站仍在运行/);
    assert.deepEqual(JSON.parse(await readFile(f.statePath, 'utf8')), record);
    assert.ok(!f.messages.some((text) => text.includes('网站已停止')));
  } finally {
    await net.close();
    await f.cleanup();
  }
});

test('停止入口：端口关闭但管理进程仍在时明确报告部分退出', async () => {
  const f = await fixture();
  const net = await listen();
  await net.close();
  try {
    await state(f, process.pid, net.port);
    await assert.rejects(stopPublic(f.options), /网页端口已关闭，但管理进程尚未退出/);
  } finally {
    await f.cleanup();
  }
});

test('停止入口：原进程已退出但其他服务占用端口时不会误停或删除记录', async () => {
  const f = await fixture();
  const net = await listen();
  try {
    const record = await state(f, await deadPid(), net.port);
    await assert.rejects(stopPublic(f.options), /端口仍有服务/);
    assert.deepEqual(JSON.parse(await readFile(f.statePath, 'utf8')), record);
    await assert.rejects(access(f.requestPath));
  } finally {
    await net.close();
    await f.cleanup();
  }
});

test('停止入口：拒绝其他目录和不合法进程标识，保留原记录', async () => {
  const f = await fixture();
  const net = await listen();
  await net.close();
  try {
    const record = await state(f, process.pid, net.port);
    for (const forged of [
      { ...record, root: dirname(f.root) },
      { ...record, pid: 0 },
      { ...record, runId: 'old-version' },
    ]) {
      await writeFile(f.statePath, JSON.stringify(forged));
      await assert.rejects(stopPublic(f.options), /启动信息无效/);
      assert.deepEqual(JSON.parse(await readFile(f.statePath, 'utf8')), forged);
      await assert.rejects(access(f.requestPath));
    }
  } finally {
    await f.cleanup();
  }
});
