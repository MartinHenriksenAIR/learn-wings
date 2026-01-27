import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { PlatformSettingsProvider } from "@/hooks/usePlatformSettings";
import { Loader2 } from "lucide-react";

// Pages
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import LearnerDashboard from "./pages/learner/Dashboard";
import LearnerCourses from "./pages/learner/Courses";
import CoursePlayer from "./pages/learner/CoursePlayer";
import Certificates from "./pages/learner/Certificates";
import OrgDashboard from "./pages/org-admin/OrgDashboard";
import OrgUsers from "./pages/org-admin/OrgUsers";
import OrgAnalytics from "./pages/org-admin/OrgAnalytics";
import PlatformDashboard from "./pages/platform-admin/PlatformDashboard";
import OrganizationsManager from "./pages/platform-admin/OrganizationsManager";
import OrganizationDetail from "./pages/platform-admin/OrganizationDetail";
import CoursesManager from "./pages/platform-admin/CoursesManager";
import CourseAccessManager from "./pages/platform-admin/CourseAccessManager";
import UsersManager from "./pages/platform-admin/UsersManager";
import CourseEditor from "./pages/platform-admin/CourseEditor";
import PlatformSettings from "./pages/platform-admin/PlatformSettings";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      
      {/* Protected learner routes */}
      <Route path="/app/dashboard" element={<ProtectedRoute><LearnerDashboard /></ProtectedRoute>} />
      <Route path="/app/courses" element={<ProtectedRoute><LearnerCourses /></ProtectedRoute>} />
      <Route path="/app/learn/:courseId" element={<ProtectedRoute><CoursePlayer /></ProtectedRoute>} />
      <Route path="/app/certificates" element={<ProtectedRoute><Certificates /></ProtectedRoute>} />
      
      {/* Protected org admin routes */}
      <Route path="/app/admin/org" element={<ProtectedRoute><OrgDashboard /></ProtectedRoute>} />
      <Route path="/app/admin/org/users" element={<ProtectedRoute><OrgUsers /></ProtectedRoute>} />
      <Route path="/app/admin/analytics" element={<ProtectedRoute><OrgAnalytics /></ProtectedRoute>} />
      
      {/* Protected platform admin routes */}
      <Route path="/app/admin/platform" element={<ProtectedRoute><PlatformDashboard /></ProtectedRoute>} />
      <Route path="/app/admin/organizations" element={<ProtectedRoute><OrganizationsManager /></ProtectedRoute>} />
      <Route path="/app/admin/organizations/:orgId" element={<ProtectedRoute><OrganizationDetail /></ProtectedRoute>} />
      <Route path="/app/admin/courses" element={<ProtectedRoute><CoursesManager /></ProtectedRoute>} />
      <Route path="/app/admin/course-access" element={<ProtectedRoute><CourseAccessManager /></ProtectedRoute>} />
      <Route path="/app/admin/courses/:courseId" element={<ProtectedRoute><CourseEditor /></ProtectedRoute>} />
      <Route path="/app/admin/users" element={<ProtectedRoute><UsersManager /></ProtectedRoute>} />
      <Route path="/app/admin/analytics/global" element={<ProtectedRoute><OrgAnalytics /></ProtectedRoute>} />
      <Route path="/app/admin/platform/settings" element={<ProtectedRoute><PlatformSettings /></ProtectedRoute>} />
      <Route path="/app/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      
      {/* Redirects */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
      
      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <PlatformSettingsProvider>
            <AppRoutes />
          </PlatformSettingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
