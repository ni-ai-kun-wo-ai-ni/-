export const UNASSIGNED_CLASS = '__unassigned__';
export const reportClassKey = (person: { classId: string | null }) =>
  person.classId || UNASSIGNED_CLASS;
