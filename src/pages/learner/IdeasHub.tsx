import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Lightbulb, MessageSquare, Library, Sparkles } from 'lucide-react';
import { MyIdeas } from '@/components/ideas/MyIdeas';
import { IdeaLibrary } from '@/components/ideas/IdeaLibrary';
import { AIBrainstormChat } from '@/components/ideas/AIBrainstormChat';

export default function IdeasHub() {
  const [activeTab, setActiveTab] = useState('brainstorm');

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ideas Hub</h1>
          <p className="text-muted-foreground mt-1">
            Brainstorm process optimization ideas with AI assistance, submit them for review, and explore ideas from your organization.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
            <TabsTrigger value="brainstorm" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">AI Brainstorm</span>
              <span className="sm:hidden">Brainstorm</span>
            </TabsTrigger>
            <TabsTrigger value="my-ideas" className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              <span className="hidden sm:inline">My Ideas</span>
              <span className="sm:hidden">Mine</span>
            </TabsTrigger>
            <TabsTrigger value="library" className="flex items-center gap-2">
              <Library className="h-4 w-4" />
              <span className="hidden sm:inline">Idea Library</span>
              <span className="sm:hidden">Library</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="brainstorm" className="space-y-4">
            <AIBrainstormChat />
          </TabsContent>

          <TabsContent value="my-ideas" className="space-y-4">
            <MyIdeas />
          </TabsContent>

          <TabsContent value="library" className="space-y-4">
            <IdeaLibrary />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
