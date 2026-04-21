import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Star, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/sonner';

interface CourseReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  courseTitle: string;
  orgId: string;
  userId: string;
  existingReview?: {
    id: string;
    rating: number;
    comment: string | null;
  };
  onReviewSubmitted?: () => void;
}

export function CourseReviewDialog({
  open,
  onOpenChange,
  courseId,
  courseTitle,
  orgId,
  userId,
  existingReview,
  onReviewSubmitted,
}: CourseReviewDialogProps) {
  const [rating, setRating] = useState(existingReview?.rating || 0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState(existingReview?.comment || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      toast({
        title: 'Rating required',
        description: 'Please select a star rating before submitting.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);

    const reviewData = {
      org_id: orgId,
      user_id: userId,
      course_id: courseId,
      rating,
      comment: comment.trim() || null,
    };

    const { error } = await supabase
      .from('course_reviews')
      .upsert(reviewData, { onConflict: 'org_id,user_id,course_id' });

    setSubmitting(false);

    if (error) {
      toast({
        title: 'Error submitting review',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: existingReview ? 'Review updated!' : 'Thank you for your review!',
      description: 'Your feedback helps us improve.',
    });

    onOpenChange(false);
    onReviewSubmitted?.();
  };

  const displayRating = hoveredRating || rating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existingReview ? 'Update Your Review' : 'Rate This Course'}
          </DialogTitle>
          <DialogDescription>
            Share your experience with "{courseTitle}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Star Rating */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    className={cn(
                      'h-8 w-8 transition-colors',
                      star <= displayRating
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-muted-foreground'
                    )}
                  />
                </button>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">
              {displayRating === 0 && 'Select a rating'}
              {displayRating === 1 && 'Poor'}
              {displayRating === 2 && 'Fair'}
              {displayRating === 3 && 'Good'}
              {displayRating === 4 && 'Very Good'}
              {displayRating === 5 && 'Excellent'}
            </span>
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <label htmlFor="comment" className="text-sm font-medium">
              Comments (optional)
            </label>
            <Textarea
              id="comment"
              placeholder="What did you like? What could be improved?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground text-right">
              {comment.length}/1000
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {existingReview ? 'Cancel' : 'Maybe Later'}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || rating === 0}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {existingReview ? 'Update Review' : 'Submit Review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
