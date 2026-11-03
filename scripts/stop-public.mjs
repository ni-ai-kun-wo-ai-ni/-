import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const stateFile = resolve(root, '.local/public-server.json');
async function readState() {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function main() {
  const state = await readState();
  if (!state) {
    console.log('网站当前未运行，无需停止。');
    return;
  }
  if (
    resolve(state.root).toLowerCase() !== root.toLowerCase() ||
    !Number.isInteger(state.pid) ||
    !Number.isInteger(state.port) ||
    state.port < 1024 ||
    state.port > 65535 ||
    !/^[a-f0-9]{32}$/.test(state.runId || '')
  )
    throw new Error('启动信息无效或属于旧版启动器，请在原运行窗口停止后重新启动。');
  await writeFile(
    resolve(root, '.local/stop-request.json'),
    JSON.stringify({ pid: state.pid, runId: state.runId }),
  );
  console.log('正在通知网站停止，请稍候…');
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const current = await readState();
    if (!current || current.runId !== state.runId) {
      // 已打开的浏览器页面可能仍显示旧内容；以本机服务是否停止作为判断。
      let reachable = false;
      try {
        await fetch(`http://127.0.0.1:${state.port}`, { signal: AbortSignal.timeout(1000) });
        reachable = true;
      } catch {
        /* 网站已停止接收请求。 */
      }
      if (!reachable) {
        console.log('网站和公网连接已停止。学生、任务及提交数据均保留。');
        return;
      }
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('未能确认网站已停止，请查看原启动窗口；没有强制结束其他进程。');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
