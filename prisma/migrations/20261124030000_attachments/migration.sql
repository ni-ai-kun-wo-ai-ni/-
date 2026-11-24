CREATE TABLE "Attachment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "data" BLOB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CollectionTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Attachment_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FormField" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Attachment_taskId_userId_idx" ON "Attachment"("taskId", "userId");
