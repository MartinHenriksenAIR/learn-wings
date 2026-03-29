import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { SearchFilter, FilterConfig } from '@/components/ui/search-filter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FileUpload } from '@/components/ui/file-upload';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { extractLmsAssetPath, getSignedLmsAssetUrl } from '@/lib/storage';
import { Course, CourseLevel, Organization, OrgCourseAccess } from '@/lib/types';
import { BookOpen, Plus, Loader2, Trash2, Building2, ShieldCheck, Search, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

export default function CoursesManager() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state from URL
  const activeTab = searchParams.get('tab') || 'courses';

  // Course list state
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<CourseLevel>('basic');
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Delete state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Course Access state
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [accessRecords, setAccessRecords] = useState<OrgCourseAccess[]>([]);
  const [orgSearchQuery, setOrgSearchQuery] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<string>('all');
  const [orgComboboxOpen, setOrgComboboxOpen] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchData = async () => {
    const [coursesRes, orgsRes, accessRes] = await Promise.all([
      supabase.from('courses').select('*').order('created_at', { ascending: false }),
      supabase.from('organizations').select('*').order('name'),
      supabase.from('org_course_access').select('*'),
    ]);

    if (coursesRes.data) {
      const coursesWithFreshThumbnails = await Promise.all(
        (coursesRes.data as Course[]).map(async (course) => ({
          ...course,
          thumbnail_url: await getSignedLmsAssetUrl(course.thumbnail_url),
        })),
      );
      setCourses(coursesWithFreshThumbnails);
    }

    if (orgsRes.data) setOrgs(orgsRes.data as Organization[]);
    if (accessRes.data) setAccessRecords(accessRes.data as OrgCourseAccess[]);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  // ========== Course CRUD ==========
  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);

    const thumbnailToPersist = extractLmsAssetPath(thumbnailUrl) ?? thumbnailUrl;

    const { error } = await supabase.from('courses').insert({
      title,
      description,
      level,
      thumbnail_url: thumbnailToPersist,
      created_by_user_id: user?.id,
      is_published: false,
    });

    if (error) {
      toast({ title: 'Failed to create course', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Course created!' });
      setCreateOpen(false); setTitle(''); setDescription(''); setLevel('basic'); setThumbnailUrl(null);
      fetchData();
    }
    setCreating(false);
  };

  const togglePublish = async (course: Course) => {
    await supabase.from('courses').update({ is_published: !course.is_published }).eq('id', course.id);
    fetchData();
  };

  const openDeleteDialog = (course: Course) => {
    setCourseToDelete(course);
    setDeleteOpen(true);
  };

  const handleDeleteCourse = async () => {
    if (!courseToDelete) return;
    setDeleting(true);
    const { error } = await supabase.from('courses').delete().eq('id', courseToDelete.id);
    if (error) {
      toast({ title: 'Failed to delete course', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Course deleted' });
      setDeleteOpen(false);
      setCourseToDelete(null);
      fetchData();
    }
    setDeleting(false);
  };

  // ========== Course Access ==========
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

  // ========== Filtering ==========
  const levelColors = { basic: 'bg-green-100 text-green-800', intermediate: 'bg-yellow-100 text-yellow-800', advanced: 'bg-red-100 text-red-800' };

  const courseFilters: FilterConfig[] = [
    {
      key: 'level',
      label: 'Level',
      options: [
        { value: 'basic', label: 'Basic' },
        { value: 'intermediate', label: 'Intermediate' },
        { value: 'advanced', label: 'Advanced' },
      ],
    },
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: 'published', label: 'Published' },
        { value: 'draft', label: 'Draft' },
      ],
    },
  ];

  const filterValues = { level: levelFilter, status: statusFilter };

  const handleFilterChange = (key: string, value: string) => {
    if (key === 'level') setLevelFilter(value);
    if (key === 'status') setStatusFilter(value);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setLevelFilter('all');
    setStatusFilter('all');
  };

  const filteredCourses = courses.filter(course => {
    const matchesSearch = searchQuery === '' ||
      course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesLevel = levelFilter === 'all' || course.level === levelFilter;

    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'published' && course.is_published) ||
      (statusFilter === 'draft' && !course.is_published);

    return matchesSearch && matchesLevel && matchesStatus;
  });

  const filteredOrgs = orgs.filter((o) => {
    const matchesSelection = selectedOrg === 'all' || o.id === selectedOrg;
    const matchesSearch = orgSearchQuery === '' || o.name.toLowerCase().includes(orgSearchQuery.toLowerCase());
    return matchesSelection && matchesSearch;
  });
  const publishedCourses = courses.filter((c) => c.is_published);

  if (loading) {
    return (
      <AppLayout title="Course Manager">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Course Manager" breadcrumbs={[{ label: 'Courses' }]}>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="access">Organization Access</TabsTrigger>
        </TabsList>

        {/* ========== Courses Tab ========== */}
        <TabsContent value="courses" className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <SearchFilter
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search courses..."
              filters={courseFilters}
              filterValues={filterValues}
              onFilterChange={handleFilterChange}
              onClearFilters={clearFilters}
              className="flex-1"
            />
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="mr-2 h-4 w-4" />Create Course</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Course</DialogTitle>
                  <DialogDescription>Add a new course to the platform.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Thumbnail</Label>
                    <FileUpload
                      bucket="lms-assets"
                      folder="thumbnails"
                      accept="image"
                      value={thumbnailUrl}
                      onChange={(url) => setThumbnailUrl(url)}
                      maxSizeMB={10}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Course title" />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Course description" />
                  </div>
                  <div className="space-y-2">
                    <Label>Level</Label>
                    <Select value={level} onValueChange={(v) => setLevel(v as CourseLevel)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="basic">Basic</SelectItem>
                        <SelectItem value="intermediate">Intermediate</SelectItem>
                        <SelectItem value="advanced">Advanced</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreate} disabled={creating}>
                    {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {filteredCourses.length === 0 ? (
            <EmptyState 
              icon={<BookOpen className="h-6 w-6" />} 
              title={searchQuery || levelFilter !== 'all' || statusFilter !== 'all' ? "No matching courses" : "No courses yet"} 
              description={searchQuery || levelFilter !== 'all' || statusFilter !== 'all' ? "Try adjusting your filters." : "Create your first course."} 
              action={!searchQuery && levelFilter === 'all' && statusFilter === 'all' ? <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />Create Course</Button> : undefined} 
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredCourses.map((course) => (
                <Card
                  key={course.id}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => navigate(`/app/admin/courses/${course.id}`)}
                >
                  {course.thumbnail_url ? (
                    <img src={course.thumbnail_url} alt={course.title} className="aspect-video object-cover" />
                  ) : (
                    <div className="aspect-video bg-gradient-to-br from-primary/80 to-primary" />
                  )}
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h3 className="font-display font-semibold">{course.title}</h3>
                      <Badge className={levelColors[course.level]}>{course.level}</Badge>
                    </div>
                    <p className="mb-4 text-sm text-muted-foreground line-clamp-2">{course.description}</p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Switch checked={course.is_published} onCheckedChange={() => togglePublish(course)} />
                        <span className="text-sm">{course.is_published ? 'Published' : 'Draft'}</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); openDeleteDialog(course); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ========== Organization Access Tab ========== */}
        <TabsContent value="access" className="space-y-6">
          {/* Info Banner */}
          <Card className="border-primary/20 bg-primary/5">
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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search organizations..."
                value={orgSearchQuery}
                onChange={(e) => setOrgSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <Popover open={orgComboboxOpen} onOpenChange={setOrgComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={orgComboboxOpen} className="w-[240px] justify-between">
                    {selectedOrg === 'all'
                      ? 'All Organizations'
                      : orgs.find((org) => org.id === selectedOrg)?.name || 'Select organization'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-0">
                  <Command>
                    <CommandInput placeholder="Search organization..." />
                    <CommandList>
                      <CommandEmpty>No organization found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="All Organizations"
                          onSelect={() => {
                            setSelectedOrg('all');
                            setOrgComboboxOpen(false);
                          }}
                        >
                          <Check className={cn('mr-2 h-4 w-4', selectedOrg === 'all' ? 'opacity-100' : 'opacity-0')} />
                          All Organizations
                        </CommandItem>
                        {orgs.map((org) => (
                          <CommandItem
                            key={org.id}
                            value={org.name}
                            onSelect={() => {
                              setSelectedOrg(org.id);
                              setOrgComboboxOpen(false);
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', selectedOrg === org.id ? 'opacity-100' : 'opacity-0')} />
                            {org.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
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
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Course?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will permanently delete <strong>"{courseToDelete?.title}"</strong> and all associated data including:
              </p>
              <ul className="list-disc list-inside text-sm">
                <li>All modules and lessons</li>
                <li>All learner enrollments and progress</li>
                <li>All quiz attempts and reviews</li>
              </ul>
              <p className="font-medium">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCourse}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Course
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
