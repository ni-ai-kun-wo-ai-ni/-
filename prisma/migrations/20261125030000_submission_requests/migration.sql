CREATE TABLE "SubmissionRequest" (
 "taskId" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "key" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,
 "receipt" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("taskId", "userId", "key"),
 FOREIGN KEY ("taskId") REFERENCES "CollectionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SubmissionRequest_createdAt_idx" ON "SubmissionRequest"("createdAt");
