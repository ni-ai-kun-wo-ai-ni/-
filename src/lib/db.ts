import { PrismaClient, type Prisma } from '@prisma/client';
import { ConcurrencyGate } from './traffic-guard';
const globalDb = globalThis as unknown as { prisma?: PrismaClient; gradeWrites?: ConcurrencyGate };
export const db = globalDb.prisma ?? new PrismaClient();
globalDb.prisma = db;
const writes = (globalDb.gradeWrites ??= new ConcurrencyGate(1, 64, 10000));
// SQLite 一次只处理一个应用写事务；等待队列有容量和超时上限。
export function writeTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
) {
  return writes.run(() => db.$transaction(work, { maxWait: 5000, timeout: 15000, ...options }));
}
