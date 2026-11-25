import { mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function backupDatabase(root, databaseUrl, { keep = 3 } = {}) {
  const sqlite = await import('node:sqlite');
  if (typeof sqlite.backup !== 'function')
    throw new Error('当前Node版本不支持一致性备份，请使用Node24或手动备份');
  const DatabaseSync = sqlite.DatabaseSync;
  if (!databaseUrl?.startsWith('file:')) throw new Error('自动备份只支持本机SQLite数据库');
  const relative = databaseUrl.slice(5).split('?')[0];
  const sourcePath = isAbsolute(relative) ? relative : resolve(root, 'prisma', relative);
  const directory = resolve(root, '.local', 'backups');
  await mkdir(directory, { recursive: true });
  const name = `grade-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.db`;
  const destination = join(directory, name),
    temporary = destination + '.partial';
  const source = new DatabaseSync(sourcePath, { readOnly: true, timeout: 5000 });
  try {
    await sqlite.backup(source, temporary, { rate: 100 });
    const snapshot = new DatabaseSync(temporary);
    try {
      // 把快照的WAL收拢为独立.db，避免重命名后留下旁路日志或依赖旁路文件。
      snapshot.exec('PRAGMA journal_mode=DELETE');
      if (snapshot.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
        throw new Error('备份完整性检查失败');
    } finally {
      snapshot.close();
    }
    await rename(temporary, destination);
  } catch (error) {
    for (const path of [temporary, temporary + '-wal', temporary + '-shm'])
      await unlink(path).catch(() => {});
    throw error;
  } finally {
    source.close();
  }
  const managed = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^grade-backup-[0-9TZ-]+-[a-f0-9-]+\.db$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const old of managed.slice(Math.max(1, keep))) {
    const oldPath = resolve(directory, old);
    if (!oldPath.startsWith(directory + (process.platform === 'win32' ? '\\' : '/')))
      throw new Error('备份目录校验失败');
    await unlink(oldPath);
  }
  return destination;
}
