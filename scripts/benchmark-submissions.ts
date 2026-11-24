import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { tokenHash } from '../src/lib/auth';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3200';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), '性能测试仅允许本机');
const database = resolve((process.env.DATABASE_URL || '').replace(/^file:/, ''));
assert.equal(dirname(database), resolve('.local'), '须显式指定 .local 内的独立测试数据库绝对路径');
assert.ok(basename(database).endsWith('.db'));
const label = process.argv.includes('--after') ? 'after' : 'before';
const db = new PrismaClient();
const users: string[] = [];
let gradeId = '',
  taskId = '';
const measurements: Record<string, { ms: number; serverTiming: string | null }[]> = {};
async function main() {
  try {
    const tag = randomBytes(6).toString('hex');
    const passwordHash = await hash(randomBytes(16).toString('hex'), 12);
    const grade = await db.grade.create({ data: { name: `临时性能测试_${tag}` } });
    gradeId = grade.id;
    const teacher = await db.user.create({
      data: {
        username: `perf_teacher_${tag}`,
        name: '虚构性能教师',
        role: 'TEACHER',
        passwordHash,
      },
    });
    users.push(teacher.id);
    const student = await db.user.create({
      data: { username: `perf_student_${tag}`, name: '虚构性能学生', passwordHash, gradeId },
    });
    users.push(student.id);
    const token = randomBytes(32).toString('hex');
    await db.session.create({
      data: { id: tokenHash(token), userId: student.id, expiresAt: new Date(Date.now() + 600000) },
    });
    const task = await db.collectionTask.create({
      data: {
        title: '临时性能测试任务',
        description: '',
        gradeId,
        creatorId: teacher.id,
        status: 'OPEN',
        deadline: new Date(Date.now() + 3600000),
        targets: { create: { userId: student.id } },
        fields: {
          create: [
            { label: '文件', type: 'FILE', position: 0 },
            { label: '说明', type: 'TEXT', required: true, position: 1 },
          ],
        },
      },
      include: { fields: { orderBy: { position: 'asc' } } },
    });
    taskId = task.id;
    const [fileField, textField] = task.fields;
    const bytes = new Uint8Array(12 * 1024 * 1024);
    for (let round = 0; round < 3; round++) {
      for (const scenario of ['text', 'file_12mb', 'retain_file_edit_text', 'two_files_6mb']) {
        const answers: Record<string, unknown> = { [textField.id]: `第${round}次测试` };
        let body: FormData | string;
        const headers: Record<string, string> = { cookie: `grade_session=${token}`, origin: base };
        if (scenario === 'retain_file_edit_text')
          answers[fileField.id] = (
            await db.attachment.findMany({
              where: { taskId, userId: student.id },
              select: { id: true },
            })
          ).map((file) => file.id);
        if (scenario === 'file_12mb' || scenario === 'two_files_6mb') {
          const form = new FormData();
          form.set('answers', JSON.stringify(answers));
          const count = scenario === 'file_12mb' ? 1 : 2;
          for (let i = 0; i < count; i++)
            form.append(
              `files:${fileField.id}`,
              new Blob([bytes.subarray(0, bytes.length / count)]),
              `测试文件${i}.zip`,
            );
          body = form;
        } else {
          body = JSON.stringify(answers);
          headers['Content-Type'] = 'application/json';
        }
        const start = performance.now();
        const response = await fetch(`${base}/api/tasks/${taskId}/submit`, {
          method: 'POST',
          headers,
          body,
        });
        const result = await response.json();
        assert.equal(response.status, 200, JSON.stringify(result));
        (measurements[scenario] ||= []).push({
          ms: Number((performance.now() - start).toFixed(1)),
          serverTiming: response.headers.get('server-timing'),
        });
      }
    }
    const medianMs = Object.fromEntries(
      Object.entries(measurements).map(([key, values]) => [
        key,
        values.map((v) => v.ms).sort((a, b) => a - b)[1],
      ]),
    );
    await mkdir('.local', { recursive: true });
    await writeFile(
      `.local/submission-benchmark-${label}.json`,
      JSON.stringify({ label, medianMs, measurements }, null, 2),
    );
    console.log(JSON.stringify({ label, medianMs }));
  } finally {
    if (taskId) {
      await db.submission.deleteMany({ where: { taskId } });
      await db.collectionTask.deleteMany({ where: { id: taskId } });
    }
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    if (gradeId) await db.grade.deleteMany({ where: { id: gradeId } });
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
