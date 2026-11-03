export type Person = {
  id: string;
  username: string;
  name: string;
  studentNumber: string | null;
  role: string;
  isClassOfficer: boolean;
  mustChangePassword: boolean;
  classId: string | null;
  class: { id: string; name: string; gradeId: string } | null;
};
export type Field = { id: string; label: string; type: string; required: boolean; options: string };
export type Task = {
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
  updatedAt: string;
  submittedAt: string;
  answers?: { fieldId: string; value: string }[];
};
export type Bootstrap = {
  user: Person;
  tasks: Task[];
  officerTasks: Task[];
  students: Person[];
  grades: {
    id: string;
    name: string;
    classes: { id: string; name: string; _count: { students: number } }[];
  }[];
};
export type Report = {
  task: Task;
  rows: (Person & { submission: Submission | null })[];
  total: number;
  submitted: number;
  canView: boolean;
};
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
export const dateText = (date: string) =>
  new Date(date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
