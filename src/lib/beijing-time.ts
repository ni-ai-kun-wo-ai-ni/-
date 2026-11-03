// 日期输入统一使用北京时间，避免受访问者电脑时区影响。
export function toBeijingInput(deadline: string | Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(deadline));
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function beijingInputToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请选择完整的截止日期和时间');
  return new Date(`${value}:00+08:00`).toISOString();
}
export function defaultDeadline() {
  return `${toBeijingInput(new Date(Date.now() + 86400000)).slice(0, 10)}T18:00`;
}
