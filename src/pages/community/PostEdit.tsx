import { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PostForm } from '@/components/community/PostForm';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/components/ui/sonner';
import { fetchCategories, fetchPost, updatePost } from '@/lib/community-api';
import { Loader2 } from 'lucide-react';
import type { CommunityScope, CreatePostInput } from '@/lib/community-types';

export default function PostEdit() {
  const navigate = useNavigate();
  const { scope: routeScope, postId } = useParams<{ scope: CommunityScope; postId: string }>();
  const { profile, effectiveIsOrgAdmin, effectiveIsPlatformAdmin } = useAuth();

  const scope = (routeScope || 'org') as CommunityScope;

  const { data: categories = [], isLoading: categoriesLoading } = useQuery({
    queryKey: ['community-categories'],
    queryFn: fetchCategories,
  });

  const { data: post, isLoading: postLoading } = useQuery({
    queryKey: ['community-post', postId],
    queryFn: () => fetchPost(postId!),
    enabled: !!postId,
  });

  const updatePostMutation = useMutation({
    mutationFn: async (data: CreatePostInput) => {
      return updatePost(postId!, {
        category_id: data.category_id,
        title: data.title,
        content: data.content,
        tags: data.tags || [],
      });
    },
    onSuccess: () => {
      toast({ title: 'Post updated' });
      navigate(`/app/community/${scope}/posts/${postId}`);
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update post', description: error.message, variant: 'destructive' });
    },
  });

  const isAdmin = scope === 'global' ? effectiveIsPlatformAdmin : effectiveIsOrgAdmin || effectiveIsPlatformAdmin;
  const isAuthor = profile?.id && post?.user_id ? profile.id === post.user_id : false;

  const initialData = useMemo(() => {
    if (!post) return undefined;
    return {
      category_id: post.category_id,
      title: post.title,
      content: post.content,
      tags: post.tags || [],
    };
  }, [post]);

  if (postLoading || categoriesLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!post) {
    return <Navigate to={`/app/community/${scope}`} replace />;
  }

  if (!isAuthor) {
    return <Navigate to={`/app/community/${scope}/posts/${postId}`} replace />;
  }

  return (
    <AppLayout>
      <PostForm
        open
        onOpenChange={(open) => {
          if (!open) {
            navigate(`/app/community/${scope}/posts/${postId}`);
          }
        }}
        onSubmit={async (data) => { await updatePostMutation.mutateAsync(data); }}
        categories={categories}
        scope={scope}
        orgId={scope === 'org' ? post.org_id || undefined : undefined}
        canPostRestricted={isAdmin}
        initialData={initialData}
        editMode
      />
    </AppLayout>
  );
}
