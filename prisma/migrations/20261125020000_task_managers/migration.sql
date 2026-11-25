CREATE TABLE "TaskManager" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    PRIMARY KEY ("taskId", "userId"),
    CONSTRAINT "TaskManager_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CollectionTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskManager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TaskManager_userId_idx" ON "TaskManager"("userId");
