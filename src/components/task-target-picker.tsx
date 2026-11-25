'use client';
import { useEffect, useRef } from 'react';
import type { Bootstrap } from '@/lib/types';

type Student = NonNullable<Bootstrap['publisherStudents']>[number];
function GroupChoice({
  label,
  ids,
  selected,
  toggle,
}: {
  label: string;
  ids: string[];
  selected: Set<string>;
  toggle: (ids: string[], checked: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const count = ids.filter((id) => selected.has(id)).length;
  const partial = count > 0 && count < ids.length;
  useEffect(() => {
    if (input.current) input.current.indeterminate = partial;
  }, [partial]);
  return (
    <label className="check">
      <input
        ref={input}
        type="checkbox"
        aria-label={label}
        aria-checked={partial ? 'mixed' : count > 0}
        checked={ids.length > 0 && count === ids.length}
        disabled={!ids.length}
        onChange={(e) => toggle(ids, e.target.checked)}
      />
      {label}{' '}
      <span className="muted">
        {count} / {ids.length} 人
      </span>
    </label>
  );
}

export default function TaskTargetPicker({
  students,
  gradeName,
  targets,
  setTargets,
}: {
  students: Student[];
  gradeName: string;
  targets: string[];
  setTargets: (update: (previous: string[]) => string[]) => void;
}) {
  const selected = new Set(targets);
  const groups = new Map<string, { name: string; ids: string[] }>();
  for (const student of students) {
    const key = student.class?.id || '';
    if (!groups.has(key)) groups.set(key, { name: student.class?.name || '暂未分班', ids: [] });
    groups.get(key)!.ids.push(student.id);
  }
  function toggle(ids: string[], checked: boolean) {
    setTargets((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return [...next];
    });
  }
  return (
    <section className="target-picker" aria-label="选择填写学生">
      <div className="target-toolbar">
        <GroupChoice
          label={`全选${gradeName || '当前年级'}`}
          ids={students.map((s) => s.id)}
          selected={selected}
          toggle={toggle}
        />
        <button
          type="button"
          className="text-button"
          disabled={!targets.length}
          onClick={() => setTargets(() => [])}
        >
          清空选择
        </button>
      </div>
      <p className="muted" role="status">
        已选 {students.filter((s) => selected.has(s.id)).length} / {students.length}{' '}
        人。按班级或年级选中后，仍可逐人调整；取消一个班级只影响该班。年级全选包含暂未分班学生，切换目标年级会清空原选择。
      </p>
      <div className="target-groups">
        {[...groups].map(([id, group]) => (
          <GroupChoice
            key={id}
            label={group.name}
            ids={group.ids}
            selected={selected}
            toggle={toggle}
          />
        ))}
      </div>
      <div className="target-list">
        {students.map((s) => (
          <label key={s.id} className="check">
            <input
              type="checkbox"
              aria-label={`${s.name}（${s.studentNumber || '无学号'}）`}
              checked={selected.has(s.id)}
              onChange={(e) => toggle([s.id], e.target.checked)}
            />
            {s.name} · {s.studentNumber || '无学号'} · {s.class?.name || '暂未分班'}
          </label>
        ))}
        {!students.length && <p className="muted">该年级暂无可选择的学生。</p>}
      </div>
    </section>
  );
}
