import * as React from 'react';
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import {
  checkUploadFileType,
  checkUploadPayloadSize,
  effectiveMaxSizeMB,
  formatSizeMB,
  UPLOAD_ACCEPT_ATTRIBUTE,
  type UploadMessage,
} from '@/lib/upload-limits';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Upload, X, FileText, Loader2, Cloud, CheckCircle2 } from 'lucide-react';

interface AzureDocumentUploadProps {
  value?: string | null;
  onChange: (blobPath: string | null) => void;
  className?: string;
  disabled?: boolean;
  /**
   * Tightens the limit below the server cap for this call site. Never widens it:
   * `effectiveMaxSizeMB` clamps to the cap the backend enforces, so the UI can't
   * promise something the save would 413 on. Defaults to the server cap.
   */
  maxSizeMB?: number;
  /**
   * Forwarded to the underlying file input so a `<Label htmlFor>` can name the
   * control (#325). Clicking such a label opens the file picker.
   */
  id?: string;
}

export function AzureDocumentUpload({
  value,
  onChange,
  className,
  disabled = false,
  maxSizeMB,
  id,
}: AzureDocumentUploadProps) {
  const { t } = useTranslation();
  const capMB = effectiveMaxSizeMB('document', maxSizeMB);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const showMessage = (message: UploadMessage) => setError(t(message.key, message.values));

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clearing the input is the single exit path for every branch below: a
    // `change` event only fires when the value changes, so a rejected file left
    // in the input makes re-picking it a no-op.
    try {
      // Mirrors the server's mint-time allow-list (extension decides, declared
      // content type must agree) rather than a local copy that can drift.
      const typeError = checkUploadFileType('document', file);
      if (typeError) {
        showMessage(typeError);
        return;
      }

      // Validate file size against the (server-clamped) cap — documents are never
      // downscaled, so what was picked is what will be uploaded.
      const sizeError = checkUploadPayloadSize(file.size, capMB);
      if (sizeError) {
        showMessage(sizeError);
        return;
      }

      setError(null);
      setUploading(true);
      setProgress(0);
      setFileName(file.name);

      try {
        const uploadData = await callApi<{ uploadUrl: string; blobPath: string; contentType: string }>('/api/azure-document-upload-url', {
          fileName: file.name,
          contentType: file.type,
        });

        if (!uploadData?.uploadUrl) {
          throw new Error('Failed to get upload URL');
        }

        const { uploadUrl, blobPath, contentType } = uploadData;

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percentComplete = Math.round((event.loaded / event.total) * 100);
              setProgress(percentComplete);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error('Upload failed'));
          xhr.ontimeout = () => reject(new Error('Upload timed out'));

          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', contentType);
          xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
          xhr.send(file);
        });

        setProgress(100);
        onChange(blobPath);
      } catch (err) {
        // The thrown text is diagnostic, not actionable, and is the one string
        // no translation could reach — log it and show the translated summary.
        console.error('Document upload failed:', err);
        setError(t('fileUpload.errorUploadFailed'));
        // Deliberately NO `onChange(null)` here — same rule as FileUpload.
        // Nothing was stored, so the parent's current value still names a live
        // blob, and since #275 saving a null is what DELETES it. Clearing the
        // optimistic name lets the tile fall back to the name derived from the
        // value that is actually still stored.
        setFileName(null);
      } finally {
        setUploading(false);
      }
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = () => {
    onChange(null);
    setFileName(null);
    setProgress(0);
  };

  const triggerUpload = () => {
    inputRef.current?.click();
  };

  const displayName = value ? value.split('/').pop()?.substring(0, 30) + '...' : null;

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={UPLOAD_ACCEPT_ATTRIBUTE.document}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || uploading}
      />

      {value ? (
        <div className="relative border rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 p-4 bg-muted/50">
            <FileText className="h-8 w-8 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{fileName || displayName}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-success" />
                {t('fileUpload.uploadedToAzure')}
              </p>
            </div>
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleRemove}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div
          onClick={!disabled && !uploading ? triggerUpload : undefined}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
            'hover:border-primary/50 hover:bg-muted/50',
            disabled && 'opacity-50 cursor-not-allowed',
            uploading && 'cursor-wait'
          )}
        >
          {uploading ? (
            <div className="space-y-3">
              <Cloud className="h-10 w-10 mx-auto text-primary animate-pulse" />
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('fileUpload.uploadingToAzure')}</p>
                <p className="text-xs text-muted-foreground truncate max-w-xs mx-auto">{fileName}</p>
                <Progress value={progress} className="h-2 w-full max-w-xs mx-auto" />
                <p className="text-xs text-muted-foreground">{progress}%</p>
              </div>
            </div>
          ) : (
            <>
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">{t('fileUpload.ctaDocument')}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('fileUpload.documentFormats')}
                {' • '}
                {t('fileUpload.maxSize', { size: formatSizeMB(capMB) })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('fileUpload.directToAzure')}
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
