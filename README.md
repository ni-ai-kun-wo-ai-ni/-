# 青禾 · 年级信息收集与统计系统

适合学习和本机小规模实验的完整 MVP。Next.js App Router + TypeScript + Tailwind CSS + Prisma 6 + SQLite。中文界面，支持电脑和手机布局，数据保存在本地。

## 立即运行

本机已安装依赖、执行迁移和 Seed。打开 PowerShell，进入项目目录：

```powershell
.\启动.ps1
```

脚本会检查依赖、补齐 `.env`、运行数据库初始化并启动开发服务。若 PowerShell 策略不允许脚本，请使用下面的手动命令，不必修改系统策略。

浏览器打开 http://127.0.0.1:3000，按 Ctrl+C 停止。开发服务和生产服务不要同时占用 3000 端口。

## 在另一台电脑从 GitHub 运行

推荐 Node.js 22 或 24，pnpm 11.25.0（本项目已使用 Node.js 24.22.1 验证）。

```powershell
git clone https://github.com/ni-ai-kun-wo-ai-ni/-.git grade-tools
cd grade-tools
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm db:setup
pnpm dev
```

本机 Codex 环境没有全局 npm/pnpm，`启动.ps1` 会自动使用已提供的 pnpm。如果需要手动执行：

```powershell
$pm = "$env:USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs"
node $pm run dev
```

后续命令中的 `pnpm` 均可替换成 `node $pm`。当前主机已下载全部依赖。

## 测试账号

所有账号密码均为 **`Demo2026!`**，只用于本地演示。人物与学号全部虚构。

| 身份              | 账号       | 范围                 |
| ----------------- | ---------- | -------------------- |
| 教师              | teacher001 | 所有年级、班级与任务 |
| 印刷工程1班班干部 | monitor001 | 本人填写 + 本班统计  |
| 印刷工程2班班干部 | monitor002 | 本人填写 + 本班统计  |
| 包装工程1班班干部 | monitor003 | 本人填写 + 本班统计  |
| 包装工程2班班干部 | monitor004 | 本人填写 + 本班统计  |
| 普通学生          | student001 | 印刷工程1班，仅本人  |
| 另一班普通学生    | student010 | 印刷工程2班，仅本人  |

共 40 名学生：4 名班干部 + student001～student036。每班 10 人。Seed 生成开放任务（包含全部七种字段和部分已提交记录），以及一个可发布的草稿。截止时间按首次初始化时刻向后推算。重复执行 Seed 会跳过已有演示数据，不清空提交。

## 体验流程

1. 教师登录，在“创建任务”填写名称、说明、年级、截止时间。
2. 可指定全年级或勾选具体学生；可设置是否允许修改、是否允许班干部查看答案。
3. 添加文本、多行文本、数字、单选、多选、日期、是/否字段，保存草稿。
4. 在任务管理发布。可以调整截止时间或手动结束。
5. 退出并以学生或班干部登录，填写与修改任务，查看自己的提交记录。
6. 班干部从“本班管理”进入统计，复制未提交名单，导出本班 Excel。即使自己不是填写对象，也能管理指定本班同学的任务。
7. 教师查看全年级统计，点击班级进度可筛选明细与统计数字，导出全年级或所选班级结果。

截止状态由服务器每次查询和提交时判断，无须定时任务。超过截止时间不可提交，手动结束不可重新发布。截止前是否能修改取决于任务设置。

## 项目结构

```text
prisma/
  schema.prisma                  数据模型
  migrations/                    可重现的 SQLite 迁移
  seed.ts                        虚构账号与任务
src/
  app/
    page.tsx                     应用入口
    layout.tsx                   中文文档与页面元信息
    globals.css                  Tailwind 入口和响应式样式
    api/[...path]/route.ts       HTTP 接口、写入事务和 Excel 导出
  components/
    workspace.tsx                登录与角色工作台、任务和名册页面
    task-builder.tsx             动态字段编辑器
    student-form.tsx             自动生成填写表单
    report-view.tsx              班级/年级统计与明细
  lib/
    auth.ts                      Session、教师权限、同源验证
    access.ts                    任务可见性、统计与导出范围
    validation.ts                Zod 校验和动态答案校验
    db.ts                        Prisma 单例
    types.ts                     前端类型和请求工具
tests/permissions.test.ts         真实 HTTP 权限与收集流程测试
启动.ps1                         Windows 启动脚本
```

## 数据库结构

- `Grade → Class → User`：多个年级，每个年级多个班级；班干部仍是 `STUDENT`，额外设置 `isClassOfficer`。
- `User.passwordHash`：bcrypt 哈希（cost 12），没有明文密码列。
- `Session`：随机 256 位 token 放入 HttpOnly、SameSite=Lax Cookie；数据库只保存 token 的 SHA-256 摘要，7 天过期，退出立即删除。
- `CollectionTask → FormField`：任务与有序字段。选择题选项保存为 JSON 字符串。
- `TaskTarget`：发布范围的学生名单快照，任务统计分母为指定学生人数，后续新增学生不会悄悄改变任务范围。
- `Submission → SubmissionAnswer`：提交和逐字段答案，答案保存为 JSON 字符串以支持多选。每个学生每个任务最多一份提交，每份提交每字段最多一个答案。
- 修改在事务内替换答案，保留首次 `submittedAt`，更新 `updatedAt`；页面和导出展示最近提交时间。

本地数据库：`prisma/dev.db`（由 `.env` 的 `DATABASE_URL="file:./dev.db"` 指定，路径相对 Prisma Schema）。迁移文件进入 Git；数据库、Session、依赖、构建产物与 `.env` 不进入 Git。

## 权限实现

所有接口均在服务器验证 Session，前端导航只负责展示。

- `auth.ts/currentUser`：每次请求从数据库恢复当前用户身份，不信任请求体的 userId、role 或 classId。
- `access.ts/accessibleTask`：学生必须是指定填写对象且任务已发布；自己的提交始终按 Session userId 查询。
- `access.ts/taskReport`：普通学生直接 403；班干部 classId 固定来自 Session，指定其他班级直接 403。教师才可查看全年级。
- 统计接口和 Excel 导出使用相同查询。未授权查看答案时，班干部的数据库查询不包含答案，Excel 仅包含姓名、学号、班级、提交时间。
- 写操作校验 Origin/Host；任务创建、发布、结束和修改截止时间均验证教师身份。
- 服务端校验必填项、类型、日期、选项、未知字段和长度。提交事务内重新检查截止和可修改状态，防止前端绕过。
- 登录使用通用错误提示和进程内账号限速；响应禁止缓存。SQLite 文件的本机访问权限仍由操作系统管理。

## 常用命令与验证

```powershell
pnpm db:migrate      # 应用已提交的迁移
pnpm db:seed         # 初始化虚构数据，已有数据则跳过
pnpm db:setup        # 生成 Client + 迁移 + Seed
pnpm lint
pnpm typecheck
pnpm build
pnpm start           # 先 build，再以生产模式运行
pnpm test            # 先在另一终端启动 dev 或 start 服务
```

自动测试使用 `http://127.0.0.1:3000`；可设置 `TEST_BASE_URL`。测试应对初始化后的演示数据库运行，会创建临时任务，结束时自动清理这些测试任务和提交，不会删除示例任务。测试覆盖未登录、错误密码、跨站请求、草稿隔离、指定学生、越权创建、伪造答案、本人修改、重复提交、禁止修改、自然截止、手动截止、跨班统计/导出、答案可见性、Excel 行列数和 Session 注销。

本次已通过 TypeScript、ESLint、生产构建和 16 项集成测试。浏览器验证了教师登录和工作台；最终完整复检结果见开发交付说明。

备份数据时先停止服务，再复制 `prisma/dev.db`，勿把带真实数据的数据库上传公开仓库。此 MVP 不包含敏感信息字段模板。

## 第一版限制

- 学生与班级管理目前提供名册查询、搜索和班级概览；新增账号、组织和班干部配置暂通过 Seed 或 Prisma 数据维护，没有批量导入、增删改界面。
- 草稿字段暂不支持保存后重新编辑、任务删除、复制任务；发布前请确认字段，需调整可重新创建。
- 教师拥有全部年级权限，暂不细分教师任教范围。
- 不支持附件、条件跳题、短信提醒、单点登录、密码找回、审计日志或提交历史版本。
- 登录限速保存在单进程内，重启清空；没有生产级抗暴力破解与运维能力。
- 默认仅绑定 127.0.0.1，本机 HTTP Cookie 不设置 Secure；不作为公开网络服务。将来使用 HTTPS 时设置 `COOKIE_SECURE=true`，并重新设计部署和安全配置。
- 小规模实验不分页；SQLite 使用本地文件，适合单机低并发。未来人员调班时，统计按当前所在班级归属。
- 刷新浏览器会回到首页；截止和新提交通知在刷新/重新进入页面后更新。
- Excel 包含未提交学生（答案空白、提交时间显示“未提交”），完成率分母只计算指定对象。没有答案权限时不导出动态答案列。

不使用 Docker、云数据库、Redis 或第三方认证。

技术选型参考：[Next.js 安装说明](https://nextjs.org/docs/app/getting-started/installation)、[Prisma 6 SQLite 文档](https://www.prisma.io/docs/orm/v6/overview/databases/sqlite)、[pnpm 构建脚本授权](https://pnpm.io/cli/approve-builds)。Prisma 固定为 6.19.0，沿用直接 SQLite 引擎以简化学习；其他依赖的实际版本由 `pnpm-lock.yaml` 锁定。
