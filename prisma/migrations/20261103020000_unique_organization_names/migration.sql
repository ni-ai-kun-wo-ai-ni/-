-- 年级名称唯一；不同年级可以有同名班级，同一年级内不能重名。
CREATE UNIQUE INDEX "Grade_name_key" ON "Grade"("name");
CREATE UNIQUE INDEX "Class_gradeId_name_key" ON "Class"("gradeId", "name");
