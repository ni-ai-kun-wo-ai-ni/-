'use client';
import { useEffect, useState } from 'react';
import {
  api,
  dateText,
  type Bootstrap,
  type Report,
  type Submission,
  type Task,
} from '@/lib/types';
import TaskBuilder from './task-builder';
import StudentForm from './student-form';
import ReportView from './report-view';
const labels: Record<string, string> = {
  home: '工作台',
  tasks: '任务管理',
  students: '学生管理',
  classes: '班级管理',
  create: '创建任务',
  records: '我的提交',
  officer: '本班管理',
  fill: '填写任务',
  report: '任务统计',
};
export default function Workspace() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('home');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<{ task: Task; submission: Submission | null } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [filterClass, setFilterClass] = useState('');
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  async function refresh() {
    const d = await api<Bootstrap>('bootstrap');
    setData(d);
  }
  useEffect(() => {
    api<Bootstrap>('bootstrap')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: string) {
    setView(next);
    setError('');
    setNotice('');
    setSearch('');
  }
  async function openTask(task: Task, mode: 'fill' | 'report') {
    await perform(async () => {
      if (mode === 'report') {
        setReport(await api<Report>(`tasks/${task.id}/report`));
        setFilterClass('');
      } else setDetail(await api(`tasks/${task.id}`));
      navigate(mode);
    });
  }
  if (loading) return <div className="loading">青禾 · 正在载入工作台…</div>;
  if (!data)
    return (
      <main className="login-layout">
        <section className="login-brand">
          <div className="brand">
            <span className="brand-icon">禾</span>青禾 <small>年级协作空间</small>
          </div>
          <div>
            <div className="eyebrow">让每一次收集，都井然有序</div>
            <h1>
              信息有序汇集，
              <br />
              年级事务更轻松。
            </h1>
            <p>
              从任务发布到班级统计，
              <br />
              为师生连接每一个清晰的步骤。
            </p>
            <div className="login-steps">
              <span>01 发布任务</span>
              <i>→</i>
              <span>02 学生填写</span>
              <i>→</i>
              <span>03 自动统计</span>
            </div>
          </div>
          <small>本地实验版 · 数据保存在你的电脑</small>
        </section>
        <section className="login-form">
          <div className="eyebrow">WELCOME BACK</div>
          <h2>登录你的工作空间</h2>
          <p className="muted">使用本地账号，继续今天的年级事务。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform(async () => {
                await api('login', { username: f.get('username'), password: f.get('password') });
                await refresh();
              });
            }}
          >
            <label>
              账号
              <input name="username" autoComplete="username" placeholder="请输入账号" required />
            </label>
            <label>
              密码
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                required
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="full" disabled={busy}>
              {busy ? '登录中…' : '登录工作空间 →'}
            </button>
          </form>
          <div className="demo-box">
            <b>体验账号</b>
            <p>
              教师 teacher001 · 班干部 monitor001
              <br />
              学生 student001
            </p>
            <p>
              统一密码 <code>Demo2026!</code>
            </p>
          </div>
          <p className="login-note">仅供学习与小规模实验，测试人物均为虚构。</p>
        </section>
      </main>
    );
  const teacher = data.user.role === 'TEACHER';
  const officer = data.user.isClassOfficer;
  const nav = teacher
    ? ['home', 'tasks', 'students', 'classes']
    : ['home', 'records', ...(officer ? ['officer'] : [])];
  const scopedTasks = data.tasks.filter((t) => !gradeFilter || t.gradeId === gradeFilter);
  const scopedStudents = data.students.filter(
    (s) => !gradeFilter || s.class?.gradeId === gradeFilter,
  );
  const scopedClasses = data.grades
    .filter((g) => !gradeFilter || g.id === gradeFilter)
    .flatMap((g) => g.classes);
  const tasks = (view === 'officer' ? data.officerTasks : scopedTasks).filter(
    (t) => t.title.includes(search) && (view !== 'records' || t.submissions?.length),
  );
  const taskCards = (items: Task[], management = teacher || view === 'officer') => (
    <div className="task-list">
      {items.length === 0 && <div className="empty">暂无符合条件的任务。</div>}
      {items.map((t) => (
        <div className="task-row" key={t.id}>
          <span className="task-icon">▤</span>
          <div className="task-main">
            <div className="task-name">
              <h3>{t.title}</h3>
              <span
                className={`badge ${t.displayStatus === '收集中' ? 'open' : t.status === 'DRAFT' ? 'draft' : 'closed'}`}
              >
                {t.displayStatus}
              </span>
            </div>
            <p>{t.description}</p>
            <small>
              截止 {dateText(t.deadline)}
              {!teacher && ` · ${t.submissions?.length ? '已提交' : '未填写'}`}
            </small>
          </div>
          <div className="task-actions">
            {management ? (
              <>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void openTask(t, 'report')}
                >
                  查看统计 ↗
                </button>
                {teacher && t.status === 'DRAFT' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api(`tasks/${t.id}/status`, { status: 'OPEN' });
                        await refresh();
                        setNotice('任务已发布');
                      })
                    }
                  >
                    发布
                  </button>
                )}
                {teacher && t.status === 'OPEN' && (
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api(`tasks/${t.id}/status`, { status: 'CLOSED' });
                        await refresh();
                        setNotice('任务已结束');
                      })
                    }
                  >
                    结束任务
                  </button>
                )}
                {teacher && t.status !== 'CLOSED' && (
                  <label className="deadline-edit">
                    调整截止
                    <input
                      aria-label={`调整${t.title}截止时间`}
                      type="datetime-local"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v)
                          void perform(async () => {
                            await api(`tasks/${t.id}/deadline`, {
                              deadline: new Date(v).toISOString(),
                            });
                            await refresh();
                          });
                      }}
                    />
                  </label>
                )}
              </>
            ) : (
              <button
                className={t.submissions?.length || t.displayStatus !== '收集中' ? 'secondary' : ''}
                disabled={busy}
                onClick={() => void openTask(t, 'fill')}
              >
                {t.submissions?.length
                  ? '查看 / 修改'
                  : t.displayStatus === '收集中'
                    ? '立即填写 →'
                    : '查看任务'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">禾</span>青禾<small>年级协作空间</small>
        </div>
        <div className="sidebar-label">工作空间</div>
        <nav>
          {nav.map((v, i) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => navigate(v)}>
              <span>{['◫', '▤', '♧', '▦'][i]}</span>
              {labels[v]}
              {v === 'tasks' && <small>{data.tasks.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-dot">本地 SQLite 数据库</div>
          <small>
            学习实验版 v1.0
            <br />
            让信息收集更简单
          </small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            工作空间 <span className="muted"> / {labels[view]}</span>
          </span>
          <div className="account">
            <span className="avatar">{data.user.name.slice(0, 1)}</span>
            <span>
              {data.user.name}
              <small>{teacher ? '教师' : officer ? '班干部' : '学生'}</small>
            </span>
            <button
              className="text-button"
              onClick={() =>
                void perform(async () => {
                  await api('logout', {});
                  setData(null);
                  navigate('home');
                })
              }
            >
              退出
            </button>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{teacher ? 'GRADE MANAGEMENT' : 'MY CAMPUS WORKSPACE'}</div>
              <h1>{view === 'home' ? `你好，${data.user.name}` : labels[view]}</h1>
              <p>
                {view === 'home'
                  ? teacher
                    ? '掌握年级动态，有条不紊地推进每一项收集任务。'
                    : '从这里开始，及时完成你的信息收集任务。'
                  : view === 'officer'
                    ? `${data.user.class?.name} · 仅显示指定本班学生的已发布任务`
                    : '年级信息收集与统计系统'}
              </p>
            </div>
            {teacher && view !== 'create' && (
              <button onClick={() => navigate('create')}>＋ 创建任务</button>
            )}
            {!teacher && <span className="badge draft">{data.user.class?.name}</span>}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {teacher && ['home', 'tasks', 'students', 'classes'].includes(view) && (
            <div className="grade-filter">
              <span>当前年级</span>
              <select
                aria-label="筛选年级"
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
              >
                <option value="">全部年级</option>
                {data.grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {view === 'home' && (
            <>
              <div className="stats">
                <div className="stat">
                  <span>{teacher ? '学生总人数' : '我的任务'}</span>
                  <strong>
                    {teacher ? scopedStudents.length : data.tasks.length}
                    <small>{teacher ? '人' : '项'}</small>
                  </strong>
                  <small>{teacher ? '覆盖当前选择的年级' : '已发布的信息收集'}</small>
                </div>
                <div className="stat">
                  <span>{teacher ? '班级数量' : '待填写'}</span>
                  <strong>
                    {teacher
                      ? scopedClasses.length
                      : data.tasks.filter(
                          (t) => t.displayStatus === '收集中' && !t.submissions?.length,
                        ).length}
                    <small>{teacher ? '个' : '项'}</small>
                  </strong>
                  <small>{teacher ? '班级协同，有序管理' : '记得在截止前完成'}</small>
                </div>
                <div className="stat">
                  <span>{teacher ? '正在收集' : '已提交'}</span>
                  <strong className="green">
                    {
                      scopedTasks.filter((t) =>
                        teacher ? t.displayStatus === '收集中' : !!t.submissions?.length,
                      ).length
                    }
                    <small>项</small>
                  </strong>
                  <small>{teacher ? '任务正在进行中' : '可在我的提交中查看'}</small>
                </div>
                <div className="stat accent">
                  <span>今日工作提示</span>
                  <h3>{teacher ? '让每份信息都有着落' : '每一次填写都很重要'}</h3>
                  <small>
                    {teacher ? '查看任务统计，及时跟进未提交同学。' : '请仔细确认信息后提交。'}
                  </small>
                </div>
              </div>
              <div className="panel">
                <div className="section-title">
                  <h2>{teacher ? '最近创建的任务' : '待填写与近期任务'}</h2>
                  <span className="muted">{scopedTasks.length} 项任务</span>
                </div>
                {taskCards(scopedTasks.slice(0, 6))}
              </div>
              {!teacher && (
                <div className="panel">
                  <h2>我的提交记录</h2>
                  {data.tasks
                    .filter((t) => t.submissions?.length)
                    .map((t) => (
                      <div className="record" key={t.id}>
                        <b>{t.title}</b>
                        <span>{dateText(t.submissions![0].updatedAt)}</span>
                        <button className="text-button" onClick={() => void openTask(t, 'fill')}>
                          查看提交 →
                        </button>
                      </div>
                    ))}
                  {!data.tasks.some((t) => t.submissions?.length) && (
                    <p className="muted">尚无提交记录，完成第一份任务后会显示在这里。</p>
                  )}
                </div>
              )}
            </>
          )}
          {['tasks', 'records', 'officer'].includes(view) && (
            <div className="panel">
              <div className="section-title">
                <h2>{labels[view]}</h2>
                <input
                  className="search"
                  aria-label="搜索任务"
                  placeholder="搜索任务名称…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {taskCards(tasks, teacher || view === 'officer')}
            </div>
          )}
          {view === 'students' && teacher && (
            <div className="panel">
              <div className="section-title">
                <h2>
                  学生名册 <small className="muted">{scopedStudents.length} 人</small>
                </h2>
                <input
                  className="search"
                  placeholder="搜索姓名、学号或班级…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>学号</th>
                      <th>班级</th>
                      <th>身份</th>
                      <th>登录账号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopedStudents
                      .filter((s) => `${s.name}${s.studentNumber}${s.class?.name}`.includes(search))
                      .map((s) => (
                        <tr key={s.id}>
                          <td>
                            <b>{s.name}</b>
                          </td>
                          <td>{s.studentNumber}</td>
                          <td>{s.class?.name}</td>
                          <td>
                            <span className={`badge ${s.isClassOfficer ? 'open' : 'draft'}`}>
                              {s.isClassOfficer ? '班干部' : '学生'}
                            </span>
                          </td>
                          <td>{s.username}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {view === 'classes' && teacher && (
            <div className="class-grid">
              {data.grades
                .filter((g) => !gradeFilter || g.id === gradeFilter)
                .flatMap((g) =>
                  g.classes.map((c) => (
                    <div key={c.id} className="panel class-card">
                      <div className="eyebrow">{g.name}</div>
                      <h2>{c.name}</h2>
                      <strong>
                        {c._count.students}
                        <small> 位同学</small>
                      </strong>
                      <p className="muted">
                        班干部：
                        {data.students
                          .filter((s) => s.classId === c.id && s.isClassOfficer)
                          .map((s) => s.name)
                          .join('、')}
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          navigate('students');
                          setSearch(c.name);
                        }}
                      >
                        查看学生名册 →
                      </button>
                    </div>
                  )),
                )}
            </div>
          )}
          {view === 'create' && teacher && (
            <TaskBuilder
              data={data}
              done={() =>
                void perform(async () => {
                  await refresh();
                  navigate('tasks');
                  setNotice('草稿已保存，点击发布即可开始收集。');
                })
              }
            />
          )}
          {view === 'fill' && detail && (
            <>
              <button className="back" onClick={() => navigate('home')}>
                ← 返回工作台
              </button>
              <StudentForm
                key={detail.task.id}
                {...detail}
                done={() =>
                  void perform(async () => {
                    await refresh();
                    navigate('records');
                    setNotice('提交已保存');
                  })
                }
              />
            </>
          )}
          {view === 'report' && report && (
            <>
              <button className="back" onClick={() => navigate(teacher ? 'tasks' : 'officer')}>
                ← 返回任务列表
              </button>
              <ReportView report={report} filterClass={filterClass} selectClass={setFilterClass} />
            </>
          )}
          <footer>
            青禾 · 年级信息收集与统计 <span>本地学习实验版 / 所有演示数据均为虚构</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
