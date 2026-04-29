import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Search, ArrowUp, ArrowDown, ChevronRight, Download, Users } from 'lucide-react';
import { UserProgressDialog } from '@/components/org-admin/UserProgressDialog';

interface UserStats {
  id: string;
  name: string;
  department: string | null;
  enrollments: number;
  completed: number;
  avgQuizScore: number;
}

interface TeamPerformanceTabProps {
  userStats: UserStats[];
  departments: string[];
  orgId?: string;
}

const ITEMS_PER_PAGE = 20;

export function TeamPerformanceTab({ userStats, departments, orgId = '' }: TeamPerformanceTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'completed' | 'score'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('list');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<UserStats | null>(null);
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);

  // Filter and sort user stats
  const filteredUserStats = useMemo(() => {
    return userStats
      .filter((user) => {
        // Search filter
        if (searchQuery && !user.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
        // Department filter
        if (selectedDepartment === 'all') return true;
        if (selectedDepartment === 'unassigned') return !user.department;
        return user.department === selectedDepartment;
      })
      .sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'completed':
            comparison = b.completed - a.completed;
            break;
          case 'score':
            comparison = b.avgQuizScore - a.avgQuizScore;
            break;
          case 'name':
          default:
            comparison = a.name.localeCompare(b.name);
            break;
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [userStats, searchQuery, selectedDepartment, sortBy, sortDirection]);

  // Group by department
  const groupedByDepartment = useMemo(() => {
    const groups: Record<string, UserStats[]> = {};
    filteredUserStats.forEach((user) => {
      const dept = user.department || 'Unassigned';
      if (!groups[dept]) groups[dept] = [];
      groups[dept].push(user);
    });
    return groups;
  }, [filteredUserStats]);

  // Pagination
  const totalPages = Math.ceil(filteredUserStats.length / ITEMS_PER_PAGE);
  const paginatedUsers = filteredUserStats.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Export to CSV
  const handleExportCSV = () => {
    const headers = ['Name', 'Department', 'Courses Enrolled', 'Courses Completed', 'Avg Quiz Score'];
    const rows = filteredUserStats.map((user) => [
      user.name,
      user.department || 'Unassigned',
      user.enrollments.toString(),
      user.completed.toString(),
      `${user.avgQuizScore}%`,
    ]);
    
    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `team-performance-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const UserRow = ({ user }: { user: UserStats }) => (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => {
        setSelectedUser(user);
        setProgressDialogOpen(true);
      }}
    >
      <TableCell className="font-medium">{user.name}</TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {user.department || <span className="italic">Unassigned</span>}
      </TableCell>
      <TableCell className="text-right">{user.enrollments}</TableCell>
      <TableCell className="text-right">{user.completed}</TableCell>
      <TableCell className="text-right">{user.avgQuizScore}%</TableCell>
      <TableCell>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      {/* Filters and Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9"
              />
            </div>

            {/* Department Filter */}
            <Select value={selectedDepartment} onValueChange={(v) => { setSelectedDepartment(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>

            {/* Sort */}
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'name' | 'completed' | 'score')}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="completed">Progress</SelectItem>
                <SelectItem value="score">Activity</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
            >
              {sortDirection === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>

            {/* View Mode */}
            <Select value={viewMode} onValueChange={(v) => setViewMode(v as 'list' | 'grouped')}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="list">List View</SelectItem>
                <SelectItem value="grouped">By Department</SelectItem>
              </SelectContent>
            </Select>

            {/* Export */}
            <Button variant="outline" onClick={handleExportCSV} className="gap-2 ml-auto">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>

          <div className="mt-3 text-sm text-muted-foreground">
            Showing {filteredUserStats.length} of {userStats.length} team members
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {filteredUserStats.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <p className="text-muted-foreground">
              {userStats.length === 0 ? 'No team members found.' : 'No results match your filters.'}
            </p>
          </CardContent>
        </Card>
      ) : viewMode === 'grouped' ? (
        /* Grouped by Department View */
        <Accordion type="multiple" defaultValue={Object.keys(groupedByDepartment)} className="space-y-2">
          {Object.entries(groupedByDepartment).map(([dept, users]) => (
            <AccordionItem key={dept} value={dept} className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{dept}</span>
                  <span className="text-sm text-muted-foreground">({users.length} members)</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Courses</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Avg Score</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow
                        key={user.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => {
                          setSelectedUser(user);
                          setProgressDialogOpen(true);
                        }}
                      >
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell className="text-right">{user.enrollments}</TableCell>
                        <TableCell className="text-right">{user.completed}</TableCell>
                        <TableCell className="text-right">{user.avgQuizScore}%</TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        /* List View with Pagination */
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Courses</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Avg Score</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedUsers.map((user) => (
                <UserRow key={user.id} user={user} />
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* User Progress Dialog */}
      {selectedUser && orgId && (
        <UserProgressDialog
          userId={selectedUser.id}
          userName={selectedUser.name}
          orgId={orgId}
          open={progressDialogOpen}
          onOpenChange={setProgressDialogOpen}
        />
      )}
    </div>
  );
}
