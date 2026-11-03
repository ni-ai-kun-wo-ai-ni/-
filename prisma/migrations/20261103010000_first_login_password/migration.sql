-- 已有账号保持当前密码；只有之后新建的学生账号需要首次登录改密。
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
