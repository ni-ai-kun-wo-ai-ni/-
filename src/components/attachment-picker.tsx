'use client';
import { useRef, useState } from 'react';
import { PHOTO_ACCEPT } from '@/lib/attachment-types';

export default function AttachmentPicker({
  id,
  label,
  photoOnly,
  disabled,
  onFiles,
}: {
  id: string;
  label: string;
  photoOnly: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [manualLink, setManualLink] = useState('');
  function selectFiles(input: HTMLInputElement) {
    const selected = Array.from(input.files || []);
    input.value = '';
    if (selected.length) onFiles(selected);
  }
  return (
    <div className="attachment-picker">
      <input
        id={id}
        ref={fileRef}
        type="file"
        multiple
        hidden
        disabled={disabled}
        // 通用文件入口不设置 accept/capture，避免手机将混合筛选误判为只能选择媒体。
        accept={photoOnly ? PHOTO_ACCEPT : undefined}
        onChange={(e) => selectFiles(e.currentTarget)}
      />
      {!photoOnly && (
        <input
          ref={photoRef}
          type="file"
          multiple
          hidden
          disabled={disabled}
          accept={PHOTO_ACCEPT}
          onChange={(e) => selectFiles(e.currentTarget)}
        />
      )}
      <div className="attachment-picker-actions">
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          aria-label={`${label}：${photoOnly ? '选择照片' : '选择文档或文件'}`}
          onClick={() => fileRef.current?.click()}
        >
          {photoOnly ? '选择照片 / 拍照' : '选择文档 / 文件'}
        </button>
        {!photoOnly && (
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            aria-label={`${label}：选择照片`}
            onClick={() => photoRef.current?.click()}
          >
            选择照片 / 拍照
          </button>
        )}
      </div>
      {!photoOnly && (
        <details className="upload-help">
          <summary>微信里只有相册，选不到文档？</summary>
          <p>
            可点微信右上角“···”，选择“在浏览器打开”，或复制下方链接到手机浏览器打开，再登录并找到该任务填写。聊天里的文件可先保存到手机，再从系统文件选择器中查找。
          </p>
          <p>切换浏览器时，未提交的填写内容不会自动带过去。</p>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const url = window.location.href;
              try {
                await navigator.clipboard.writeText(url);
                setManualLink('');
                setCopyMessage('链接已复制，请粘贴到手机浏览器打开。');
              } catch {
                setManualLink(url);
                setCopyMessage('请长按下方链接手动复制到手机浏览器。');
              }
            }}
          >
            复制网站链接
          </button>
          {copyMessage && <p role="status">{copyMessage}</p>}
          {manualLink && (
            <input
              aria-label="网站链接"
              readOnly
              value={manualLink}
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </details>
      )}
    </div>
  );
}
