-- 班级学生通过 Class 归属年级；此列仅保存暂未分班学生的年级。
ALTER TABLE "User" ADD COLUMN "gradeId" TEXT REFERENCES "Grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
