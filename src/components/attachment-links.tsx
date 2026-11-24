import { attachmentUrl, type AttachmentInfo } from '@/lib/attachment-types';

export default function AttachmentLinks({ files }: { files: AttachmentInfo[] }) {
  return (
    <div className="attachment-list">
      {files.map((file) => (
        <div key={file.id}>
          <a href={attachmentUrl(file.id)} download>
            {file.name}
          </a>
          <small className="muted">（{Math.max(1, Math.round(file.size / 1024))} KB）</small>
          {file.mime.startsWith('image/') && (
            <a href={attachmentUrl(file.id, true)} target="_blank" rel="noreferrer">
              查看照片
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
