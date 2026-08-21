import * as React from 'react';
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { mintedUpload, releaseUpload, type MintedUpload } from '@/lib/blob-release';
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
  maxSizeMB?: number;
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
  const mintedRef = useRef<MintedUpload | null>(null);

  const showMessage = (message: UploadMessage) => setError(t(message.key, message.values));

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const typeError = checkUploadFileType('document', file);
      if (typeError) {
        showMessage(typeError);
        return;
      }

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
        const uploadData = await callApi<{ uploadUrl: string; blobPath: string; contentType: string; releaseToken?: string | null }>('/api/azure-document-upload-url', {
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
        const superseded = mintedRef.current;
        mintedRef.current = mintedUpload(uploadData);
        releaseUpload(superseded);
        onChange(blobPath);
      } catch (err) {
        console.error('Document upload failed:', err);
        setError(t('fileUpload.errorUploadFailed'));
        setFileName(null);
      } finally {
        setUploading(false);
      }
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = () => {
    const discarded = mintedRef.current;
    mintedRef.current = null;
    releaseUpload(discarded);
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

      {value && !uploading ? (
        <div
          onClick={!disabled ? triggerUpload : undefined}
          className={cn(
            'relative border rounded-legacy-lg overflow-hidden',
            !disabled && 'cursor-pointer transition-colors hover:border-legacy-primary/50'
          )}
        >
          <div className="flex items-center gap-3 p-4 bg-legacy-muted/50">
            <FileText className="h-8 w-8 text-legacy-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{fileName || displayName}</p>
              <p className="text-xs text-legacy-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-legacy-success" />
                <span className="truncate">
                  {t('fileUpload.uploadedToAzure')}
                  {!disabled && ` • ${t('fileUpload.clickToReplace')}`}
                </span>
              </p>
            </div>
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
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
            'border-2 border-dashed rounded-legacy-lg p-6 text-center cursor-pointer transition-colors',
            'hover:border-legacy-primary/50 hover:bg-legacy-muted/50',
            disabled && 'opacity-50 cursor-not-allowed',
            uploading && 'cursor-wait'
          )}
        >
          {uploading ? (
            <div className="space-y-3">
              <Cloud className="h-10 w-10 mx-auto text-legacy-primary animate-pulse" />
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('fileUpload.uploadingToAzure')}</p>
                <p className="text-xs text-legacy-muted-foreground truncate max-w-xs mx-auto">{fileName}</p>
                <Progress value={progress} className="h-2 w-full max-w-xs mx-auto" />
                <p className="text-xs text-legacy-muted-foreground">{progress}%</p>
              </div>
            </div>
          ) : (
            <>
              <Upload className="h-10 w-10 mx-auto text-legacy-muted-foreground mb-2" />
              <p className="text-sm font-medium">{t('fileUpload.ctaDocument')}</p>
              <p className="text-xs text-legacy-muted-foreground mt-1">
                {t('fileUpload.documentFormats')}
                {' • '}
                {t('fileUpload.maxSize', { size: formatSizeMB(capMB) })}
              </p>
              <p className="text-xs text-legacy-muted-foreground mt-1">
                {t('fileUpload.directToAzure')}
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-legacy-destructive">{error}</p>
      )}
    </div>
  );
}
