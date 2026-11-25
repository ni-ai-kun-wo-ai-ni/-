import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { backupDatabase } from '../scripts/database-backup.mjs';

test('一致性备份包含WAL中的已提交数据，限制留存且不删除其他文件', async () => {
  const parent = resolve('.local/tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'backup-review-'));
  let db: DatabaseSync | undefined;
  try {
    await mkdir(join(root, 'prisma'));
    db = new DatabaseSync(join(root, 'prisma', 'test.db'));
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE data(value TEXT); INSERT INTO data VALUES ('已提交')",
    );
    const first = await backupDatabase(root, 'file:./test.db', { keep: 2 });
    db.exec("UPDATE data SET value='后续修改'");
    const snapshot = new DatabaseSync(first, { readOnly: true });
    try {
      assert.equal(snapshot.prepare('SELECT value FROM data').get()?.value, '已提交');
    } finally {
      snapshot.close();
    }
    const folder = join(root, '.local', 'backups');
    await writeFile(join(folder, 'notes.db'), '应保留');
    await backupDatabase(root, 'file:./test.db', { keep: 2 });
    await backupDatabase(root, 'file:./test.db', { keep: 2 });
    assert.equal(
      (await readdir(folder)).filter((name) => name.startsWith('grade-backup-')).length,
      2,
    );
    assert.equal(await readFile(join(folder, 'notes.db'), 'utf8'), '应保留');
  } finally {
    db?.close();
    assert.ok(resolve(root).startsWith(parent + sep));
    await rm(root, { recursive: true, force: true });
  }
});
