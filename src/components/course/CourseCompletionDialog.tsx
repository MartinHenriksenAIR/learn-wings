import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Award, Star, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';

interface CourseCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseTitle: string;
  onLeaveReview: () => void;
}

export function CourseCompletionDialog({
  open,
  onOpenChange,
  courseTitle,
  onLeaveReview,
}: CourseCompletionDialogProps) {
  const navigate = useNavigate();
  const { features } = usePlatformSettings();

  const handleGoToCourses = () => {
    onOpenChange(false);
    navigate('/app/courses');
  };

  const handleGoToCertificates = () => {
    onOpenChange(false);
    navigate('/app/dashboard#certificates');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md text-center">
        <DialogHeader className="items-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
            <Award className="h-8 w-8 text-success" />
          </div>
          <DialogTitle className="text-2xl">Congratulations! 🎉</DialogTitle>
          <DialogDescription className="text-base">
            You've completed <span className="font-semibold">{courseTitle}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {features.certificates_enabled && (
            <p className="text-sm text-muted-foreground">
              Your certificate is now available in your certificates section.
            </p>
          )}

          {features.course_reviews_enabled && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                onLeaveReview();
              }}
            >
              <Star className="mr-2 h-4 w-4" />
              Leave a Review
            </Button>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {features.certificates_enabled && (
            <Button className="w-full" onClick={handleGoToCertificates}>
              View Certificate
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" className="w-full" onClick={handleGoToCourses}>
            Back to Courses
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
