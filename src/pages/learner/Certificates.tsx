import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Enrollment, Course } from '@/lib/types';
import { Award, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Certificates() {
  const { user, currentOrg, profile } = useAuth();
  const [completedEnrollments, setCompletedEnrollments] = useState<(Enrollment & { course: Course })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user || !currentOrg) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('enrollments')
        .select('*, course:courses(*)')
        .eq('user_id', user.id)
        .eq('org_id', currentOrg.id)
        .eq('status', 'completed');

      if (data) {
        setCompletedEnrollments(data as any);
      }
      setLoading(false);
    };

    fetchData();
  }, [user, currentOrg]);

  if (loading) {
    return (
      <AppLayout title="Certificates" breadcrumbs={[{ label: 'Certificates' }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout title="Certificates" breadcrumbs={[{ label: 'Certificates' }]}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <Award className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">No organization selected.</p>
          <p className="text-sm text-muted-foreground">Join an organization to earn certificates.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Certificates" breadcrumbs={[{ label: 'Certificates' }]}>
      {completedEnrollments.length === 0 ? (
        <EmptyState
          icon={<Award className="h-6 w-6" />}
          title="No certificates yet"
          description="Complete courses to earn certificates. They'll appear here once you finish."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {completedEnrollments.map((enrollment) => (
            <Card key={enrollment.id} className="overflow-hidden">
              <div className="bg-gradient-to-br from-primary via-primary/90 to-accent/40 p-6 text-primary-foreground">
                <div className="flex items-center gap-2 mb-4">
                  <Award className="h-8 w-8" />
                  <span className="text-sm font-medium uppercase tracking-wider opacity-80">
                    Certificate of Completion
                  </span>
                </div>
                <h3 className="font-display text-xl font-bold mb-2">
                  {enrollment.course?.title}
                </h3>
                <p className="text-sm opacity-80">
                  Awarded to {profile?.full_name}
                </p>
              </div>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Completed on {new Date(enrollment.completed_at!).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </div>
                  <Button variant="outline" size="sm" disabled>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
