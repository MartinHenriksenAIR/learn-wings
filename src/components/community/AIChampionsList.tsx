import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ChampionProfile {
  id: string;
  full_name: string;
  department: string | null;
}

interface AIChampion {
  id: string;
  user_id: string;
  org_id: string;
  assigned_at: string;
  profile: ChampionProfile | null;
}

interface AIChampionsListProps {
  orgId: string;
}

export function AIChampionsList({ orgId }: AIChampionsListProps) {
  const { data: champions = [], isLoading } = useQuery({
    queryKey: ['ai-champions', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_champions')
        .select(`
          *,
          profile:profiles!ai_champions_user_id_fkey(id, full_name, department)
        `)
        .eq('org_id', orgId)
        .order('assigned_at', { ascending: false });

      if (error) throw error;
      return data as unknown as AIChampion[];
    },
    enabled: !!orgId,
  });

  if (isLoading || champions.length === 0) {
    return null;
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-warning" />
          AI Champions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground mb-3">
          Reach out to these team members for AI guidance and support.
        </p>
        {champions.map((champion) => (
          <div
            key={champion.id}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {champion.profile?.full_name
                  ? getInitials(champion.profile.full_name)
                  : '??'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {champion.profile?.full_name || 'Unknown User'}
              </p>
              {champion.profile?.department && (
                <p className="text-xs text-muted-foreground truncate">
                  {champion.profile.department}
                </p>
              )}
            </div>
            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 shrink-0">
              <Sparkles className="h-3 w-3 mr-1" />
              Champion
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}