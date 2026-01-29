import * as React from 'react';
import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const ACCEPT_STRING = ACCEPTED_TYPES.join(',');

export function AzureDocumentUpload({
  value,
  onChange,
  className,
  disabled = false,
  maxSizeMB = 100,
}: AzureDocumentUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please select a valid document (PDF, Word, Excel, or PowerPoint)');
      return;
    }

    // Validate file size
    if (file.size > maxSizeMB * 1024 * 1024) {
      setError(`File size must be less than ${maxSizeMB}MB`);
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);
    setFileName(file.name);

    try {
      // Step 1: Get signed upload URL from edge function
      const { data: uploadData, error: uploadError } = await supabase.functions.invoke('azure-document-upload-url', {
        body: { 
          fileName: file.name,
          contentType: file.type,
        },
      });

      if (uploadError || !uploadData?.uploadUrl) {
        throw new Error(uploadError?.message || 'Failed to get upload URL');
      }

      const { uploadUrl, blobPath, contentType } = uploadData;

      // Step 2: Upload directly to Azure using XMLHttpRequest for progress tracking
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

      // Step 3: Success - return the blob path
      setProgress(100);
      onChange(blobPath);

    } catch (err: any) {
      console.error('Document upload error:', err);
      setError(err.message || 'Upload failed');
      onChange(null);
    } finally {
      setUploading(false);
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

  // Extract display name from blob path
  const displayName = value ? value.split('/').pop()?.substring(0, 30) + '...' : null;

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_STRING}
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
                Uploaded to Azure Cloud
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
                <p className="text-sm font-medium">Uploading to Azure Cloud...</p>
                <p className="text-xs text-muted-foreground truncate max-w-xs mx-auto">{fileName}</p>
                <Progress value={progress} className="h-2 w-full max-w-xs mx-auto" />
                <p className="text-xs text-muted-foreground">{progress}%</p>
              </div>
            </div>
          ) : (
            <>
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Click to upload document</p>
              <p className="text-xs text-muted-foreground mt-1">
                PDF, Word, Excel, PowerPoint • Max {maxSizeMB}MB
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Uploads directly to Azure Cloud Storage
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
