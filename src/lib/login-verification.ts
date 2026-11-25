import { compare } from 'bcryptjs';
// 不存在的账号同样执行bcrypt校验，减小通过耗时枚举账号的差异。
const DUMMY_HASH = '$2b$12$UtxyCT20W5XS4ljeyfwLQ.Y.VQIo3vZgI71KSZKDm1esUFyi7I4Lu';
export async function verifyLoginPassword(password: string, passwordHash?: string) {
  const verified = await compare(password, passwordHash || DUMMY_HASH);
  return !!passwordHash && verified;
}
