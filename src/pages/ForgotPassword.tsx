import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function ForgotPassword() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <p className="text-muted-foreground">
          Password reset is managed by your organization's IT administrator via Microsoft Entra ID.
        </p>
        <Link to="/login">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to sign in
          </Button>
        </Link>
      </div>
    </div>
  );
}
