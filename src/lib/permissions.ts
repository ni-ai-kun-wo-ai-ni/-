// 学生干部保留学生填写身份；项目权限按创建人或明确指定的共同管理人限定，不继承教师权限。
type Actor = { id: string; role: string; isStudentOfficer: boolean };
export const canPublishTasks = (user: Pick<Actor, 'role' | 'isStudentOfficer'>) =>
  user.role === 'TEACHER' || (user.role === 'STUDENT' && user.isStudentOfficer);
export const canManageTask = (
  user: Actor,
  task: { creatorId: string; managers?: { userId: string }[] },
) =>
  user.role === 'TEACHER' ||
  (user.role === 'STUDENT' &&
    user.isStudentOfficer &&
    (task.creatorId === user.id || !!task.managers?.some((manager) => manager.userId === user.id)));
