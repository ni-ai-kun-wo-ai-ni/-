export type SubmissionReceipt = { submittedAt: string; updatedAt: string };
export type UploadProgress = {
  phase: 'uploading' | 'saving';
  percent: number | null;
  loaded: number;
  total: number;
};

// 使用原生上传事件显示真实发送进度；上传100%后仍需等待服务器确认保存。
export function sendSubmission(
  taskId: string,
  body: FormData | Record<string, unknown>,
  onProgress: (progress: UploadProgress) => void,
  intent?: { key: string; version: string },
): Promise<SubmissionReceipt> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const multipart = body instanceof FormData;
    request.upload.onprogress = (event) => {
      if (multipart)
        onProgress({
          phase: 'uploading',
          percent:
            event.lengthComputable && event.total > 0
              ? Math.min(100, Math.round((event.loaded / event.total) * 100))
              : null,
          loaded: event.loaded,
          total: event.total,
        });
    };
    request.upload.onload = () =>
      onProgress({ phase: 'saving', percent: 100, loaded: 0, total: 0 });
    request.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(request.responseText);
      } catch {
        reject(new Error('未收到有效的保存结果，请检查网络后重试'));
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(new Error('未收到有效的保存结果，请检查网络后重试'));
        return;
      }
      const result = parsed as {
        ok?: unknown;
        error?: unknown;
        submission?: Partial<SubmissionReceipt>;
      };
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(typeof result.error === 'string' ? result.error : '提交失败'));
        return;
      }
      if (
        result.ok !== true ||
        typeof result.submission?.updatedAt !== 'string' ||
        typeof result.submission.submittedAt !== 'string' ||
        !Number.isFinite(Date.parse(result.submission.updatedAt)) ||
        !Number.isFinite(Date.parse(result.submission.submittedAt))
      ) {
        reject(new Error('未收到保存确认，请刷新查看提交记录'));
        return;
      }
      resolve({
        updatedAt: result.submission.updatedAt,
        submittedAt: result.submission.submittedAt,
      });
    };
    request.onerror = () => reject(new Error('上传连接中断，请检查网络后重试，已选文件仍保留'));
    request.onabort = () => reject(new Error('上传已取消，填写内容和已选文件仍保留'));
    request.timeout = 180000;
    request.ontimeout = () =>
      reject(new Error('等待服务器确认超时，请重试，填写内容和已选文件仍保留'));
    request.open('POST', `/api/tasks/${encodeURIComponent(taskId)}/submit`);
    if (intent) {
      request.setRequestHeader('Idempotency-Key', intent.key);
      request.setRequestHeader('X-Submission-Version', intent.version);
    }
    if (!multipart) request.setRequestHeader('Content-Type', 'application/json');
    request.send(multipart ? body : JSON.stringify(body));
  });
}
