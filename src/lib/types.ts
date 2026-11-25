export type Person = {
  id: string;
  username: string;
  name: string;
  studentNumber: string | null;
  role: string;
  isSuperAdmin: boolean;
  isClassOfficer: boolean;
  isStudentOfficer: boolean;
  mustChangePassword: boolean;
  classId: string | null;
  gradeId: string | null;
  grade: { id: string; name: string } | null;
  class: { id: string; name: string; gradeId: string } | null;
};
export type Field = { id: string; label: string; type: string; required: boolean; options: string };
export type Task = {
  creatorId: string;
  managers?: { userId: string }[];
  id: string;
  title: string;
  description: string;
  deadline: string;
  status: string;
  displayStatus: string;
  allowEdit: boolean;
  officerCanView: boolean;
  gradeId: string;
  fields?: Field[];
  submissions?: { submittedAt: string; updatedAt: string }[];
};
export type Submission = {
  attachments?: import('./attachment-types').AttachmentInfo[];
  updatedAt: string;
  submittedAt: string;
  answers?: { fieldId: string; value: string }[];
};
export type Bootstrap = {
  user: Person;
  tasks: Task[];
  officerTasks: Task[];
  managedTasks?: Task[];
  publisherStudents?: Pick<Person, 'id' | 'name' | 'studentNumber' | 'gradeId' | 'class'>[];
  managerCandidates?: Pick<Person, 'id' | 'name' | 'studentNumber' | 'class'>[];
  students: Person[];
  grades: {
    id: string;
    name: string;
    classes: { id: string; name: string; _count: { students: number } }[];
  }[];
};
export type Report = {
  task: Task;
  rows: (Pick<
    Person,
    'id' | 'name' | 'studentNumber' | 'classId' | 'gradeId' | 'grade' | 'class'
  > & { submission: Submission | null })[];
  total: number;
  submitted: number;
  canView: boolean;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
    let data: T & { error?: string };
    try {
      data = await response.json();
    } catch {
      throw new ApiError('未收到有效的服务器响应，请稍后重试', response.status);
    }
    if (!response.ok)
      throw new ApiError(
        typeof data?.error === 'string' ? data.error : '请求失败，请重试',
        response.status,
      );
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      throw new ApiError('等待服务器超时，请检查网络后重试', 408);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export const dateText = (date: string) =>
  new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
