import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
const db = new PrismaClient();
async function main() {
  // 重复执行不清空已有问卷和学生提交。
  if (await db.user.findUnique({ where: { username: 'teacher001' } })) {
    console.log('测试账号已存在，跳过 Seed，保留已有数据。');
    return;
  }
  const passwordHash = await hash('Demo2026!', 12);
  const grade = await db.grade.create({ data: { name: '2025级' } });
  const teacher = await db.user.create({
    data: { username: 'teacher001', name: '演示教师', passwordHash, role: 'TEACHER' },
  });
  const ids: string[] = [];
  let studentIndex = 1;
  for (const [i, name] of ['印刷工程1班', '印刷工程2班', '包装工程1班', '包装工程2班'].entries()) {
    const cls = await db.class.create({ data: { name, gradeId: grade.id } });
    for (let j = 0; j < 10; j++) {
      const username =
        j === 0
          ? `monitor${String(i + 1).padStart(3, '0')}`
          : `student${String(studentIndex++).padStart(3, '0')}`;
      const u = await db.user.create({
        data: {
          username,
          name: `虚构同学${i + 1}${String(j + 1).padStart(2, '0')}`,
          studentNumber: `2025${i + 1}${String(j + 1).padStart(3, '0')}`,
          classId: cls.id,
          isClassOfficer: j === 0,
          passwordHash,
        },
      });
      ids.push(u.id);
    }
  }
  const task = await db.collectionTask.create({
    data: {
      title: '秋季校园活动意向收集',
      description:
        '这是一份使用虚构数据的演示问卷。请填写你的活动偏好，便于体验动态表单与班级统计。请勿填写敏感个人信息。',
      gradeId: grade.id,
      creatorId: teacher.id,
      status: 'OPEN',
      deadline: new Date(Date.now() + 30 * 86400000),
      officerCanView: true,
      targets: { create: ids.map((userId) => ({ userId })) },
      fields: {
        create: [
          { label: '活动昵称', type: 'TEXT', required: true, position: 0 },
          {
            label: '最想参加的活动',
            type: 'RADIO',
            options: JSON.stringify(['校园跑步', '读书分享', '创意设计']),
            required: true,
            position: 1,
          },
          {
            label: '可参加的时段',
            type: 'CHECKBOX',
            options: JSON.stringify(['周五晚上', '周六上午', '周日下午']),
            required: true,
            position: 2,
          },
          { label: '预计参加次数', type: 'NUMBER', required: true, position: 3 },
          { label: '方便参加的日期', type: 'DATE', required: false, position: 4 },
          { label: '是否愿意担任志愿者', type: 'BOOLEAN', required: true, position: 5 },
          { label: '其他建议', type: 'TEXTAREA', required: false, position: 6 },
        ],
      },
    },
    include: { fields: { orderBy: { position: 'asc' } } },
  });
  for (let i = 0; i < ids.length; i++)
    if (i % 3 === 2) {
      const values = [`演示昵称${i}`, '读书分享', ['周六上午'], '2', '', '是', '期待参加校园活动'];
      await db.submission.create({
        data: {
          taskId: task.id,
          userId: ids[i],
          answers: {
            create: task.fields.map((f, j) => ({
              fieldId: f.id,
              value: JSON.stringify(values[j]),
            })),
          },
        },
      });
    }
  await db.collectionTask.create({
    data: {
      title: '学习小组报名（草稿示例）',
      description: '教师可以发布此草稿后体验收集流程。',
      gradeId: grade.id,
      creatorId: teacher.id,
      deadline: new Date(Date.now() + 45 * 86400000),
      targets: { create: ids.map((userId) => ({ userId })) },
      fields: { create: { label: '感兴趣的学习方向', type: 'TEXT', required: true, position: 0 } },
    },
  });
  console.log('Seed 完成：1 名教师、4 个班、40 名虚构学生、2 个任务。统一密码：Demo2026!');
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
