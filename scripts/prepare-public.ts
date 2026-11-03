import { PrismaClient, type User } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const db = new PrismaClient();
async function main() {
  await mkdir('.local', { recursive: true });
  const users = await db.user.findMany({ orderBy: { username: 'asc' } });
  if (!users.length) throw new Error('请先运行 db:setup 初始化数据库');
  const changes: { user: User; password: string; passwordHash: string }[] = [];
  for (const user of users) {
    if (!(await compare('Demo2026!', user.passwordHash))) continue;
    const password = randomBytes(18).toString('base64url');
    changes.push({ user, password, passwordHash: await hash(password, 12) });
  }
  if (!changes.length) {
    console.log('所有账号均已更换演示密码，无需重复修改。');
    return;
  }
  const filename = '.local/公网账号密码.csv';
  let accountPasswords: Record<string, string> = {};
  try {
    accountPasswords = JSON.parse(await readFile('.local/accounts.json', 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  let previous = '';
  try {
    previous = await readFile(filename, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = changes.map(({ user, password }) =>
    [
      user.username,
      user.name,
      user.role === 'TEACHER' ? '教师' : user.isClassOfficer ? '班干部' : '学生',
      password,
    ]
      .map(quote)
      .join(','),
  );
  // 先持久化新密码，避免数据库更新成功但文件保存失败导致管理员无法登录。
  await writeFile(
    filename,
    (previous || '\ufeff账号,姓名,身份,密码\r\n') + lines.join('\r\n') + '\r\n',
    { mode: 0o600 },
  );
  for (const change of changes) accountPasswords[change.user.username] = change.password;
  await writeFile('.local/accounts.json', JSON.stringify(accountPasswords, null, 2), {
    mode: 0o600,
  });
  await db.$transaction(async (tx) => {
    for (const change of changes)
      await tx.user.update({
        where: { id: change.user.id },
        data: { passwordHash: change.passwordHash },
      });
    await tx.session.deleteMany({});
  });
  console.log(
    `已替换 ${changes.length} 个演示密码并注销旧 Session。账号文件：${filename}（已被 Git 忽略，请私下分发对应账号）。`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
