import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Course, Organization, OrgCourseAccess } from '@/lib/types';
import { BookOpen, Building2, Loader2, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function CourseAccessManager() {
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [accessRecords, setAccessRecords] = useState<OrgCourseAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<string>('all');
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchData = async () => {
    const [coursesRes, orgsRes, accessRes] = await Promise.all([
      supabase.from('courses').select('*').order('title'),
      supabase.from('organizations').select('*').order('name'),
      supabase.from('org_course_access').select('*'),
    ]);

    if (coursesRes.data) setCourses(coursesRes.data as Course[]);
    if (orgsRes.data) setOrgs(orgsRes.data as Organization[]);
    if (accessRes.data) setAccessRecords(accessRes.data as OrgCourseAccess[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getAccessStatus = (orgId: string, courseId: string): boolean => {
    const record = accessRecords.find(
      (r) => r.org_id === orgId && r.course_id === courseId
    );
    return record?.access === 'enabled';
  };

  const toggleAccess = async (orgId: string, courseId: string, currentEnabled: boolean) => {
    const key = `${orgId}-${courseId}`;
    setUpdating(key);

    const existingRecord = accessRecords.find(
      (r) => r.org_id === orgId && r.course_id === courseId
    );

    if (existingRecord) {
      // Update existing record
      const { error } = await supabase
        .from('org_course_access')
        .update({ access: currentEnabled ? 'disabled' : 'enabled' })
        .eq('id', existingRecord.id);

      if (error) {
        toast({
          title: 'Failed to update access',
          description: error.message,
          variant: 'destructive',
        });
      }
    } else {
      // Create new record (enabling access)
      const { error } = await supabase.from('org_course_access').insert({
        org_id: orgId,
        course_id: courseId,
        access: 'enabled',
      });

      if (error) {
        toast({
          title: 'Failed to grant access',
          description: error.message,
          variant: 'destructive',
        });
      }
    }

    await fetchData();
    setUpdating(null);
  };

  const enableAllForOrg = async (orgId: string) => {
    setUpdating(`all-${orgId}`);
    
    const publishedCourses = courses.filter((c) => c.is_published);
    const existingAccess = accessRecords.filter((r) => r.org_id === orgId);
    
    for (const course of publishedCourses) {
      const existing = existingAccess.find((r) => r.course_id === course.id);
      if (existing) {
        if (existing.access !== 'enabled') {
          await supabase
            .from('org_course_access')
            .update({ access: 'enabled' })
            .eq('id', existing.id);
        }
      } else {
        await supabase.from('org_course_access').insert({
          org_id: orgId,
          course_id: course.id,
          access: 'enabled',
        });
      }
    }

    toast({
      title: 'Access granted',
      description: 'All published courses are now accessible to this organization.',
    });
    
    await fetchData();
    setUpdating(null);
  };

  const filteredOrgs = selectedOrg === 'all' ? orgs : orgs.filter((o) => o.id === selectedOrg);
  const publishedCourses = courses.filter((c) => c.is_published);

  if (loading) {
    return (
      <AppLayout title="Course Access" breadcrumbs={[{ label: 'Course Access' }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout 
      title="Course Access Management" 
      breadcrumbs={[{ label: 'Course Access' }]}
    >
      {/* Info Banner */}
      <Card className="mb-6 border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 py-4">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <p className="font-medium text-primary">Course Visibility Control</p>
            <p className="text-sm text-muted-foreground">
              Only published courses can be made accessible. Toggle the switch to enable or disable 
              access for each organization. Learners will only see courses that are both published 
              AND enabled for their organization.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filter by Organization:</span>
        </div>
        <Select value={selectedOrg} onValueChange={setSelectedOrg}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="All Organizations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Organizations</SelectItem>
            {orgs.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                {org.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Access Matrix */}
      {publishedCourses.length === 0 ? (
        <Card className="p-8 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
          <p className="text-muted-foreground">No published courses available.</p>
          <p className="text-sm text-muted-foreground">Publish a course first to manage access.</p>
        </Card>
      ) : filteredOrgs.length === 0 ? (
        <Card className="p-8 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
          <p className="text-muted-foreground">No organizations found.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {filteredOrgs.map((org) => (
            <Card key={org.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{org.name}</CardTitle>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => enableAllForOrg(org.id)}
                  disabled={updating === `all-${org.id}`}
                >
                  {updating === `all-${org.id}` ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Enable All Courses
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Course</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Access</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {publishedCourses.map((course) => {
                      const isEnabled = getAccessStatus(org.id, course.id);
                      const key = `${org.id}-${course.id}`;
                      return (
                        <TableRow key={course.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded bg-accent/10">
                                <BookOpen className="h-4 w-4 text-accent" />
                              </div>
                              <span className="font-medium">{course.title}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {course.level}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={isEnabled ? 'default' : 'secondary'}
                              className={isEnabled ? 'bg-green-100 text-green-800' : ''}
                            >
                              {isEnabled ? 'Enabled' : 'Disabled'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              {updating === key && (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              )}
                              <Switch
                                checked={isEnabled}
                                onCheckedChange={() => toggleAccess(org.id, course.id, isEnabled)}
                                disabled={updating === key}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
