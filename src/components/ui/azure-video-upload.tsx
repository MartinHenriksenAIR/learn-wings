import * as React from 'react';
import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Upload, X, Video, Loader2, Cloud, CheckCircle2 } from 'lucide-react';

interface AzureVideoUploadProps {
  value?: string | null;
  onChange: (blobPath: string | null) => void;
  className?: string;
  disabled?: boolean;
}

export function AzureVideoUpload({
  value,
  onChange,
  className,
  disabled = false,
}: AzureVideoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load preview URL when value changes
  React.useEffect(() => {
    const loadPreview = async () => {
      if (!value) {
        setPreviewUrl(null);
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('azure-view-url', {
          body: { blobPath: value },
        });

        if (error) {
          console.error('Error loading preview:', error);
          return;
        }

        if (data?.viewUrl) {
          setPreviewUrl(data.viewUrl);
        }
      } catch (err) {
        console.error('Error loading preview:', err);
      }
    };

    loadPreview();
  }, [value]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/')) {
      setError('Please select a video file');
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);
    setFileName(file.name);

    try {
      // Step 1: Get signed upload URL from edge function
      const { data: uploadData, error: uploadError } = await supabase.functions.invoke('azure-upload-url', {
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
      console.error('Upload error:', err);
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
    setPreviewUrl(null);
  };

  const triggerUpload = () => {
    inputRef.current?.click();
  };

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/*"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || uploading}
      />

      {value ? (
        <div className="relative border rounded-lg overflow-hidden">
          <div className="aspect-video bg-muted relative">
            {previewUrl ? (
              <video
                src={previewUrl}
                controls
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Video className="mx-auto h-12 w-12 mb-2" />
                  <p className="text-sm">Loading preview...</p>
                </div>
              </div>
            )}
            {!disabled && (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 h-8 w-8"
                onClick={handleRemove}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="p-3 bg-muted/50 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-sm text-muted-foreground">
              Video uploaded to Azure Cloud
            </span>
          </div>
        </div>
      ) : (
        <div
          onClick={!disabled && !uploading ? triggerUpload : undefined}
          className={cn(
            'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
            'hover:border-primary/50 hover:bg-muted/50',
            disabled && 'opacity-50 cursor-not-allowed',
            uploading && 'cursor-wait'
          )}
        >
          {uploading ? (
            <div className="space-y-4">
              <Cloud className="h-12 w-12 mx-auto text-primary animate-pulse" />
              <div className="space-y-2">
                <p className="text-sm font-medium">Uploading to Azure Cloud...</p>
                <p className="text-xs text-muted-foreground">{fileName}</p>
                <Progress value={progress} className="h-2 w-full max-w-xs mx-auto" />
                <p className="text-xs text-muted-foreground">{progress}%</p>
              </div>
            </div>
          ) : (
            <>
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Click to upload video</p>
              <p className="text-xs text-muted-foreground mt-1">
                Unlimited file size • MP4, WebM, MOV
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
