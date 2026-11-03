import { z } from 'zod';
import type { FormField } from '@prisma/client';
import { HttpError } from './auth';
export const fieldTypes = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'RADIO',
  'CHECKBOX',
  'DATE',
  'BOOLEAN',
] as const;
export const taskSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().max(2000),
  gradeId: z.string().min(1),
  deadline: z.string().datetime({ offset: true }),
  allowEdit: z.boolean(),
  officerCanView: z.boolean(),
  targetIds: z.array(z.string()).max(2000).optional(),
  fields: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(100),
        type: z.enum(fieldTypes),
        required: z.boolean(),
        options: z.array(z.string().trim().min(1).max(100)).max(30),
      }),
    )
    .min(1)
    .max(30),
});
export function validateAnswers(fields: FormField[], raw: unknown) {
  const input = z.record(z.string(), z.unknown()).parse(raw);
  if (Object.keys(input).some((id) => !fields.some((f) => f.id === id)))
    throw new HttpError(400, '包含未知字段');
  return fields.map((field) => {
    const v = input[field.id];
    const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (field.required) throw new HttpError(400, `请填写${field.label}`);
      return { fieldId: field.id, value: JSON.stringify('') };
    }
    const options: string[] = JSON.parse(field.options);
    let valid = false;
    switch (field.type) {
      case 'TEXT':
      case 'TEXTAREA':
        valid =
          typeof v === 'string' &&
          v.trim().length > 0 &&
          v.length <= (field.type === 'TEXT' ? 500 : 5000);
        break;
      case 'NUMBER':
        valid = typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
        break;
      case 'DATE':
        valid =
          typeof v === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(v) &&
          !Number.isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v;
        break;
      case 'RADIO':
        valid = typeof v === 'string' && options.includes(v);
        break;
      case 'CHECKBOX':
        valid =
          Array.isArray(v) &&
          v.every((x) => typeof x === 'string' && options.includes(x)) &&
          new Set(v).size === v.length;
        break;
      case 'BOOLEAN':
        valid = v === '是' || v === '否';
        break;
    }
    if (!valid) throw new HttpError(400, `${field.label}格式不正确`);
    return { fieldId: field.id, value: JSON.stringify(v) };
  });
}
