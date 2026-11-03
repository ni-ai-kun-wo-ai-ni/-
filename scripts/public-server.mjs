// 一个进程管理本地 Next.js 与公网隧道；不开放路由器端口，不修改 Windows 防火墙。
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { compare } from 'bcryptjs';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
process.loadEnvFile(resolve('.env'));
const local = resolve('.local');
const executable = resolve('.local/bin/cloudflared.exe');
const expectedHash = '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343';
const download =
  'https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-windows-amd64.exe';
const port = Number(process.env.PUBLIC_PORT || 3100);
const stateFile = resolve(local, 'public-server.json');
const stopRequestFile = resolve(local, 'stop-request.json');
const runId = randomBytes(16).toString('hex');
let stopWatcher;
let stateWritten = false;
let app;
let tunnel;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(stopWatcher);
  app?.kill();
  tunnel?.kill();
  if (stateWritten) {
    try {
      rmSync(stateFile, { force: true });
    } catch {
      /* 不影响进程退出。 */
    }
    stateWritten = false;
  }
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
async function main() {
  if (process.platform !== 'win32') throw new Error('此启动脚本当前面向 Windows。');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PUBLIC_PORT 不合法');
  await access('.next/BUILD_ID');
  await mkdir(resolve(local, 'bin'), { recursive: true });
  const db = new PrismaClient();
  try {
    const users = await db.user.findMany({ select: { passwordHash: true } });
    if (!users.length) throw new Error('请先初始化数据库');
    for (const user of users)
      if (await compare('Demo2026!', user.passwordHash))
        throw new Error('存在公开的演示密码，请先运行 public:prepare');
  } finally {
    await db.$disconnect();
  }
  let binary;
  try {
    binary = await readFile(executable);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log('下载 Cloudflare 官方隧道工具 2026.10.7…');
    const response = await fetch(download, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    binary = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(binary).digest('hex') !== expectedHash)
      throw new Error('官方工具 SHA256 不匹配，拒绝运行');
    await writeFile(executable, binary);
  }
  if (createHash('sha256').update(binary).digest('hex') !== expectedHash)
    throw new Error('隧道工具校验失败，请重新下载');
  console.log('正在建立公网 HTTPS 隧道…');
  tunnel = spawn(
    executable,
    ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const origin = await new Promise((resolveOrigin, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('90 秒内未能建立隧道，请检查网络后重试')),
      90000,
    );
    let text = '';
    const onData = (chunk) => {
      const line = chunk.toString();
      process.stdout.write(line);
      text = (text + line).slice(-20000);
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolveOrigin(match[0]);
      }
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
    tunnel.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    tunnel.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`隧道退出：${code}`));
    });
  });
  if (stopping || tunnel.exitCode !== null) throw new Error('隧道已退出');
  app = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, PUBLIC_MODE: 'true', PUBLIC_ORIGIN: origin, COOKIE_SECURE: 'true' },
    },
  );
  app.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  app.on('exit', (code) => {
    if (!stopping) {
      console.error(`Web 服务已退出：${code}`);
      stop(1);
    }
  });
  tunnel.on('exit', (code) => {
    if (!stopping) {
      console.error(`公网隧道已断开：${code}`);
      stop(1);
    }
  });
  // 本机网站准备好再打开浏览器，防止用户看到启动期间的连接错误。
  const readyDeadline = Date.now() + 30000;
  let ready = false;
  while (!stopping && Date.now() < readyDeadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Next.js 仍在启动，稍后再试。 */
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  if (!ready || stopping) throw new Error('网站未能准备就绪，请检查上方错误。');
  await writeFile(resolve(local, 'public-url.txt'), origin + '\n');
  await writeFile(
    stateFile,
    JSON.stringify({ pid: process.pid, port, url: origin, root: resolve(root), runId }),
  );
  stateWritten = true;
  // 仅接收本机项目目录里的停止请求；随机运行标识防止旧请求误停下一次启动。
  // 不提供公网停止 API，也不按进程名批量结束其他程序。
  stopWatcher = setInterval(async () => {
    try {
      const request = JSON.parse(await readFile(stopRequestFile, 'utf8'));
      if (request.pid === process.pid && request.runId === runId) {
        rmSync(stopRequestFile, { force: true });
        console.log('收到本机停止请求，正在关闭网站和公网连接。');
        stop();
      }
    } catch {
      /* 没有停止请求时保持运行。 */
    }
  }, 500);
  stopWatcher.unref();
  console.log(
    `\n公网访问地址：${origin}\n账号密码文件：${resolve(local, '公网账号密码.csv')}\n电脑需持续开机联网。按 Ctrl+C 同时停止网页和隧道。重启后公网地址会变化。\n`,
  );
  if (process.argv.includes('--open')) {
    const browser = spawn('explorer.exe', [origin], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log('无法自动打开浏览器，请复制上方公网地址手动打开。'));
  }
}
main().catch((error) => {
  console.error(error.message);
  stop(1);
});
