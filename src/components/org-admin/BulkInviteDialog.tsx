import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Upload, Download, FileSpreadsheet, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { z } from 'zod';
import { sendInvitationEmail } from '@/lib/sendInvitationEmail';

interface BulkInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  orgName: string;
  userId: string;
  onSuccess: () => void;
}

interface ParsedInvite {
  email: string;
  role: 'learner' | 'org_admin';
  first_name: string;
  last_name: string;
  department: string;
  valid: boolean;
  error?: string;
}

const emailSchema = z.string().email();

export function BulkInviteDialog({
  open,
  onOpenChange,
  orgId,
  orgName,
  userId,
  onSuccess,
}: BulkInviteDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedData, setParsedData] = useState<ParsedInvite[]>([]);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{ success: number; failed: number } | null>(null);

  const handleDownloadTemplate = () => {
    const csvContent = 'email,first_name,last_name,department,role\njohn.doe@example.com,John,Doe,Engineering,learner\njane.smith@example.com,Jane,Smith,Management,org_admin';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'invitation_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: 'Template downloaded',
      description: 'Fill in the template and upload it to bulk invite users.',
    });
  };

  const parseCsvFile = (file: File): Promise<ParsedInvite[]> => {
    return new Promise((resolve, reject) => {
      Papa.parse<{ email: string; first_name?: string; last_name?: string; department?: string; role: string }>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const parsed: ParsedInvite[] = results.data.map((row) => {
              const email = String(row.email || '').trim().toLowerCase();
              const firstName = String(row.first_name || '').trim();
              const lastName = String(row.last_name || '').trim();
              const department = String(row.department || '').trim();
              const roleRaw = String(row.role || '').trim().toLowerCase();
              const role = roleRaw === 'org_admin' || roleRaw === 'admin' ? 'org_admin' : 'learner';

              // Validate email
              const emailResult = emailSchema.safeParse(email);
              if (!emailResult.success) {
                return {
                  email,
                  first_name: firstName,
                  last_name: lastName,
                  department,
                  role,
                  valid: false,
                  error: 'Invalid email format',
                };
              }

              return { email, first_name: firstName, last_name: lastName, department, role, valid: true };
            });

            // Check for duplicates
            const seen = new Set<string>();
            parsed.forEach((item) => {
              if (item.valid) {
                if (seen.has(item.email)) {
                  item.valid = false;
                  item.error = 'Duplicate email';
                } else {
                  seen.add(item.email);
                }
              }
            });

            resolve(parsed);
          } catch (err) {
            reject(new Error('Failed to parse CSV file'));
          }
        },
        error: (error) => {
          reject(new Error(error.message || 'Failed to parse CSV file'));
        },
      });
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setResults(null);

    try {
      const parsed = await parseCsvFile(file);
      setParsedData(parsed);
    } catch (err: any) {
      toast({
        title: 'Failed to parse file',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBulkInvite = async () => {
    const validInvites = parsedData.filter((p) => p.valid);
    if (validInvites.length === 0) {
      toast({
        title: 'No valid invitations',
        description: 'Please fix the errors and try again.',
        variant: 'destructive',
      });
      return;
    }

    setProcessing(true);
    let success = 0;
    let failed = 0;
    let emailsSent = 0;

    for (const invite of validInvites) {
      const { data: insertedInvitation, error } = await supabase
        .from('invitations')
        .insert({
          org_id: orgId,
          email: invite.email,
          role: invite.role,
          invited_by_user_id: userId,
          first_name: invite.first_name || null,
          last_name: invite.last_name || null,
          department: invite.department || null,
        })
        .select('id')
        .single();

      if (error) {
        failed++;
        // Mark as invalid in UI
        const idx = parsedData.findIndex((p) => p.email === invite.email);
        if (idx !== -1) {
          parsedData[idx].valid = false;
          parsedData[idx].error = error.message.includes('duplicate')
            ? 'Already invited'
            : error.message;
        }
      } else {
        success++;
        
        // Send invitation email
        if (insertedInvitation?.id) {
          const { data: linkId } = await supabase
            .rpc('get_invitation_link_id', { invitation_id: insertedInvitation.id });
          
          if (linkId) {
            const emailResult = await sendInvitationEmail({
              email: invite.email,
              orgName,
              role: invite.role,
              linkId,
            });
            if (emailResult.success) {
              emailsSent++;
            }
          }
        }
      }
    }

    setResults({ success, failed });
    setParsedData([...parsedData]);
    setProcessing(false);

    if (success > 0) {
      toast({
        title: `${success} invitation${success > 1 ? 's' : ''} created`,
        description: emailsSent > 0 
          ? `${emailsSent} email${emailsSent > 1 ? 's' : ''} sent.${failed > 0 ? ` ${failed} failed.` : ''}`
          : failed > 0 ? `${failed} failed. Check the list for details.` : undefined,
      });
      onSuccess();
    }
  };

  const handleClose = () => {
    setParsedData([]);
    setResults(null);
    onOpenChange(false);
  };

  const validCount = parsedData.filter((p) => p.valid).length;
  const invalidCount = parsedData.filter((p) => !p.valid).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Invite Members</DialogTitle>
          <DialogDescription>
            Upload a CSV file to invite multiple members to {orgName}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* Download Template */}
          <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/50">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-8 w-8 text-accent" />
              <div>
                <p className="font-medium">Download Template</p>
                <p className="text-sm text-muted-foreground">
                  Use this CSV template to format your invitations correctly.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleDownloadTemplate}>
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>

          {/* Upload Section */}
          <div className="space-y-2">
            <Label>Upload CSV File</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/50"
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-accent" />
                  <p className="text-sm text-muted-foreground">Parsing file...</p>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Click to upload CSV file (.csv)
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Preview Table */}
          {parsedData.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <Badge variant="outline" className="bg-green-100 text-green-800">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {validCount} valid
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="outline" className="bg-red-100 text-red-800">
                    <XCircle className="mr-1 h-3 w-3" />
                    {invalidCount} invalid
                  </Badge>
                )}
              </div>

              <div className="border rounded-lg max-h-60 overflow-x-auto overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Status</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>First Name</TableHead>
                      <TableHead>Last Name</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          {row.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{row.email}</TableCell>
                        <TableCell>{row.first_name || '-'}</TableCell>
                        <TableCell>{row.last_name || '-'}</TableCell>
                        <TableCell>{row.department || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {row.role === 'org_admin' ? 'Admin' : 'Learner'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-destructive text-sm">
                          {row.error || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Results */}
          {results && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {results.success} invitation{results.success !== 1 ? 's' : ''} created successfully.
                {results.failed > 0 && ` ${results.failed} failed.`}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {results ? 'Close' : 'Cancel'}
          </Button>
          {!results && (
            <Button
              onClick={handleBulkInvite}
              disabled={processing || validCount === 0}
            >
              {processing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Invite {validCount} Member{validCount !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
