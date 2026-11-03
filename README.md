# 青禾 · 年级信息收集与统计系统

适合学习和本机小规模实验的完整 MVP。Next.js App Router + TypeScript + Tailwind CSS + Prisma 6 + SQLite。中文界面，支持电脑和手机布局，数据保存在本地。

## 让校外和手机流量也能访问（公网模式）

在项目目录执行：

```powershell
.\公网启动.ps1
```

脚本依次初始化数据库、替换默认演示密码、构建生产版，启动本机 `127.0.0.1:3100` 服务并建立 Cloudflare HTTPS 隧道。在终端显示的 `https://…trycloudflare.com` 地址可以发给其他网络的同学。访问者需要用你分配的账号登录，学生/班干部的后端权限规则保持有效。

- 数据库仍保存在本机 `prisma/dev.db`。浏览器请求经过 Cloudflare 转发，不需要云数据库、路由器端口映射或关闭防火墙。
- 工具从 Cloudflare 官方发布下载，锁定 2026.10.7，执行前检查 SHA256；启动脚本面向 Windows x64。
- 所有仍使用 `Demo2026!` 的账号都会换成各自独立的随机密码，旧 Session 注销。新密码在 **`.local/公网账号密码.csv`**，可在本机用 Excel 打开，只把对应学生的账号密码私下告知本人；不要转发整个文件。
- `.local/accounts.json` 用于本机自动测试；`.local/public-url.txt` 保存当前公网地址。这些文件和隧道工具均被 Git 忽略，切勿上传密码文件。
- 再次运行不会重新修改已经替换的密码。第一次执行后，下面“测试账号”章节里的统一密码对这些账号已经失效，本地登录也需使用新密码。
- 电脑必须开机、联网，脚本进程必须保持运行。Ctrl+C 同时停止网页与隧道；关闭电脑、休眠或断网期间无法访问。
- 这是适合 MVP 体验的临时公网入口，重启隧道会改变网址，没有持续可用保证。校园网/运营商也可能限制相关连接。固定长期网址需要域名和持久 Cloudflare Tunnel 配置；本项目没有购买域名或创建云账号。
- 固定域名部署时，显式设置 `PUBLIC_ORIGIN=https://你的域名`、`PUBLIC_MODE=true`、`COOKIE_SECURE=true`。服务端只接受指定来源的写操作，不盲目信任客户端提供的转发头。

已有构建和数据库时，可直接运行 `pnpm public:start`，无须每次重新构建。源码改动后先 `pnpm build`。

公网回归测试（先启动公网服务，测试会创建并清理虚构测试任务）：

```powershell
$env:TEST_BASE_URL = (Get-Content .local/public-url.txt).Trim()
$env:TEST_ACCOUNTS_FILE = '.local/accounts.json'
pnpm test
```

当前已完成公网模式下的本机 HTTP 回归：17 项测试通过，包括代理来源校验、随机密码登录、班级隔离及 Excel 权限。实际公网连通性需以成功启动隧道后的验证为准。

官方说明：[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。临时隧道用于测试与开发，不应当作正式长期运行方案。

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

### 教师添加和删除学生

教师进入“学生管理”后点击“添加学生”，填写姓名、学号、年级、班级、登录账号及初始密码，可勾选班干部身份。账号需为 3～40 位字母/数字/下划线/点/横线；学号只允许字母、数字、下划线和横线；密码至少10位且含字母和数字（bcrypt 最多72字节）。账号、学号均不能重复。密码仅以哈希保存，请私下告知对应学生，不会写入原来的演示账号 CSV。

新增学生不自动加入已经创建的任务，教师之后创建任务时可选择该学生。

点击名册中的“删除账号”，输入该学生登录账号再次确认。**删除不可恢复，会删除该学生及其提交、答案、任务关联和登录 Session，相关任务统计人数会变化**；任务本身和其他学生数据保留。不能通过此入口删除教师。普通学生和班干部直接调用新增/删除接口也会收到 403。

实现位于 `src/lib/students.ts` 和 `src/components/student-management.tsx`，不需要变更数据库结构。新增集成测试 `tests/student-management.test.ts` 仅允许连接本机，测试时只创建和删除临时测试学生，不能对公网发送凭据。建议使用独立测试库，避免用户数据影响测试条件。

### 已有学生转班

教师在“学生管理”中点击对应学生的“转班”，选择目标年级和班级后确认。支持同年级和跨年级转班，不允许选择当前班级。默认以普通学生身份转入；只有明确勾选“转入后设为班干部”才会获得目标班级管理权限。

账号、密码、学号、历史任务填写对象和提交答案均保留，已有登录在下次请求即按新的班级/身份校验，无需重新登录。名册、班级人数、任务统计及 Excel 都按当前班级归属，不保存历史班级快照；不自动加入目标年级以前创建的任务。并发操作导致所属班级变化时，接口会要求刷新后重新操作。

后端实现 `transferStudent` 位于 `src/lib/students.ts`，页面位于 `src/components/transfer-student-dialog.tsx`；`tests/student-transfer.test.ts` 覆盖教师权限、跨班/跨年级、历史记录保留和旧 Session 权限隔离。

截止状态由服务器每次查询和提交时判断，无须定时任务。超过截止时间不可提交，手动结束不可重新发布。截止前是否能修改取决于任务设置。

教师在“任务管理”或首页任务卡片点击“删除任务”，输入完整任务名称确认后，可删除草稿、收集中或已截止任务。**删除不可恢复，会同时删除该任务的字段、填写名单、全部提交及答案**；需要保留结果时请先导出 Excel。其他任务、学生账号不会被删除。学生和班干部没有删除权限，后端也会拒绝越权请求。

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
    student-management.tsx       教师新增和删除学生账号
  lib/
    auth.ts                      Session、教师权限、同源验证
    access.ts                    任务可见性、统计与导出范围
    validation.ts                Zod 校验和动态答案校验
    db.ts                        Prisma 单例
    types.ts                     前端类型和请求工具
    students.ts                  学生账号验证、教师权限和事务删除
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

当前已通过 TypeScript、ESLint、生产构建和 39 项测试（在独立 SQLite 测试库验证，包含学生账号增删、学生转班、任务删除与原有权限回归）。

备份数据时先停止服务，再复制 `prisma/dev.db`，勿把带真实数据的数据库上传公开仓库。此 MVP 不包含敏感信息字段模板。

## 第一版限制

- 学生管理支持教师新增、删除和转班，可在创建或转班时指定班干部；暂不支持修改姓名学号、批量导入、密码重置。班级与年级管理仍为查询，组织维护暂通过 Seed 或 Prisma。
- 草稿字段暂不支持保存后重新编辑或复制任务；可以删除写错的任务后重新创建。
- 教师拥有全部年级权限，暂不细分教师任教范围。
- 不支持附件、条件跳题、短信提醒、单点登录、密码找回、审计日志或提交历史版本。
- 登录限速保存在单进程内，重启清空；没有生产级抗暴力破解与运维能力。
- 默认仅绑定 127.0.0.1，本机 HTTP Cookie 不设置 Secure；不作为公开网络服务。将来使用 HTTPS 时设置 `COOKIE_SECURE=true`，并重新设计部署和安全配置。
- 小规模实验不分页；SQLite 使用本地文件，适合单机低并发。未来人员调班时，统计按当前所在班级归属。
- 刷新浏览器会回到首页；截止和新提交通知在刷新/重新进入页面后更新。
- Excel 包含未提交学生（答案空白、提交时间显示“未提交”），完成率分母只计算指定对象。没有答案权限时不导出动态答案列。

不使用 Docker、云数据库、Redis 或第三方认证。

技术选型参考：[Next.js 安装说明](https://nextjs.org/docs/app/getting-started/installation)、[Prisma 6 SQLite 文档](https://www.prisma.io/docs/orm/v6/overview/databases/sqlite)、[pnpm 构建脚本授权](https://pnpm.io/cli/approve-builds)。Prisma 固定为 6.19.0，沿用直接 SQLite 引擎以简化学习；其他依赖的实际版本由 `pnpm-lock.yaml` 锁定。
