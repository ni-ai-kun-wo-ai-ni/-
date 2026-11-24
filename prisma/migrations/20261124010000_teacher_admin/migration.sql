ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- 现有站点的所有者；演示账号不会自动获得此权限。
UPDATE "User" SET "isSuperAdmin" = true
WHERE "username" = '15210972001' AND "role" = 'TEACHER';
