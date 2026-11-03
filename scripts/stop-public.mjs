import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

// 直接检测本机 TCP 端口，避免浏览器缓存、HTTP 代理或旧连接影响停止判断。
function portIsOpen(port) {
  return new Promise((done, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') done(false);
      else reject(error);
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('本机端口检查超时，暂时无法确认网站状态'));
    });
  });
}

export async function stopPublic({
  root = projectRoot,
  timeoutMs = 10000,
  pollMs = 250,
  log = console.log,
} = {}) {
  root = resolve(root);
  const stateFile = resolve(root, '.local/public-server.json');
  const requestFile = resolve(root, '.local/stop-request.json');
  const state = await readJson(stateFile);
  if (!state) {
    log('未发现正在运行的网站记录，无需重复停止。');
    return;
  }
  if (
    typeof state.root !== 'string' ||
    resolve(state.root).toLowerCase() !== root.toLowerCase() ||
    !Number.isInteger(state.pid) ||
    state.pid <= 0 ||
    !Number.isInteger(state.port) ||
    state.port < 1024 ||
    state.port > 65535 ||
    !/^[a-f0-9]{32}$/.test(state.runId || '')
  )
    throw new Error('启动信息无效或属于旧版启动器，请在原运行窗口停止后重新启动。');

  async function clearOldRecords() {
    // 只清理本次运行对应的旧记录，不删除另一轮启动的信息。
    const current = await readJson(stateFile);
    if (current?.runId === state.runId && current.pid === state.pid)
      await rm(stateFile, { force: true });
    const request = await readJson(requestFile);
    if (request?.runId === state.runId && request.pid === state.pid)
      await rm(requestFile, { force: true });
  }
  async function confirmStopped() {
    if (!processExists(state.pid) && !(await portIsOpen(state.port))) {
      await clearOldRecords();
      log('网站已停止；旧运行记录已清理。学生、任务及提交数据均保留。');
      return true;
    }
    return false;
  }
  // 用户关闭原运行窗口或进程意外退出后，状态文件可能仍然存在。
  if (await confirmStopped()) return;
  if (!processExists(state.pid))
    throw new Error('原管理进程已退出，但本机端口仍有服务；未强制关闭其他程序，请查看原启动窗口');
  await writeFile(requestFile, JSON.stringify({ pid: state.pid, runId: state.runId }));
  log('正在通知网站停止，请稍候…');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await readJson(stateFile);
    if (current && current.runId !== state.runId)
      throw new Error(
        '检测到网站已重新启动，旧停止请求不会关闭新网站；如需停止请再次点击停止快捷方式',
      );
    if (await confirmStopped()) return;
    await new Promise((done) => setTimeout(done, pollMs));
  }
  if (await confirmStopped()) return;
  if (!(await portIsOpen(state.port)))
    throw new Error('网页端口已关闭，但管理进程尚未退出，请查看原启动窗口；没有强制结束其他进程');
  throw new Error('网站仍在运行，未收到停止确认，请查看原启动窗口；没有强制结束其他进程');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  stopPublic().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
