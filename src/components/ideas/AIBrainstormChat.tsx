import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Sparkles, Send, Loader2, RotateCcw, Lightbulb } from 'lucide-react';
import { AIMessage } from '@/lib/ideas-types';
import { cn } from '@/lib/utils';

const INITIAL_SUGGESTIONS = [
  "I've noticed our team spends a lot of time on manual data entry...",
  "What if we could automate the customer onboarding process?",
  "I think there's an opportunity to streamline our reporting workflow...",
  "We have repetitive tasks in our department that could benefit from AI...",
];

export function AIBrainstormChat() {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const userInitials = profile?.full_name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U';

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: AIMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Simulate AI response for now - will be replaced with edge function
    setTimeout(() => {
      const aiResponse: AIMessage = {
        role: 'assistant',
        content: generateMockResponse(userMessage.content, messages.length),
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, aiResponse]);
      setIsLoading(false);
    }, 1500);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
  };

  const handleReset = () => {
    setMessages([]);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Brainstorm Partner</CardTitle>
              <CardDescription>
                Share your ideas and I'll help you refine them
              </CardDescription>
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Start Over
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col overflow-hidden pb-4">
        <ScrollArea className="flex-1 pr-4" ref={scrollAreaRef}>
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <Lightbulb className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">Let's brainstorm!</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                I'm your AI sparring partner for process optimization ideas. 
                I'll help you think critically about feasibility, scope, and impact.
                Try starting with one of these:
              </p>
              <div className="grid gap-2 w-full max-w-md">
                {INITIAL_SUGGESTIONS.map((suggestion, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="text-left h-auto py-3 px-4 justify-start text-wrap"
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    <span className="line-clamp-2">{suggestion}</span>
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4 pb-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={cn(
                    'flex gap-3',
                    message.role === 'user' ? 'flex-row-reverse' : ''
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className={cn(
                      'text-xs',
                      message.role === 'assistant' ? 'bg-primary text-primary-foreground' : ''
                    )}>
                      {message.role === 'assistant' ? 'AI' : userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={cn(
                      'rounded-lg px-4 py-2 max-w-[80%]',
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      AI
                    </AvatarFallback>
                  </Avatar>
                  <div className="rounded-lg px-4 py-2 bg-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div className="flex gap-2 mt-4 pt-4 border-t">
          <Textarea
            placeholder="Describe your process optimization idea..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[60px] max-h-[120px] resize-none"
            disabled={isLoading}
          />
          <Button 
            onClick={handleSend} 
            disabled={!input.trim() || isLoading}
            size="icon"
            className="shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Temporary mock response generator - will be replaced with edge function
function generateMockResponse(userMessage: string, messageCount: number): string {
  const responses = [
    `That's an interesting observation! Let me ask you a few clarifying questions:\n\n1. **Scope**: Which specific part of this process takes the most time? Can you walk me through a typical workflow?\n\n2. **Frequency**: How often does this process occur? Daily? Weekly? This helps us estimate the potential impact.\n\n3. **Current pain points**: What are the top 3 frustrations your team experiences with this process today?`,
    
    `I appreciate you sharing more details. Before we go further, let me challenge an assumption:\n\n**Have you considered whether this process actually needs to exist at all?** Sometimes the best optimization is elimination.\n\nThat said, if the process is necessary, here are some angles to explore:\n\n- **Input quality**: Could better upstream data reduce downstream work?\n- **Automation potential**: What percentage of decisions in this workflow are rule-based vs. judgment calls?\n- **Integration opportunities**: Are there existing tools that could connect better?`,
    
    `You're building a clearer picture. Let's think about **feasibility**:\n\n**Quick wins** (1-2 weeks):\n- Standardized templates or checklists\n- Simple automation rules\n\n**Medium effort** (1-3 months):\n- Workflow automation with existing tools\n- API integrations\n\n**Major initiative** (3+ months):\n- Custom AI solution\n- Process redesign\n\nWhich category feels most appropriate for your idea? And importantly: who would need to approve this, and what resources would be required?`,
    
    `Now we're getting somewhere! Let me help you frame this as a concrete proposal:\n\n**Problem Statement Draft:**\nBased on what you've shared, it sounds like the core problem is [process inefficiency] leading to [time/cost impact].\n\n**Questions to strengthen your case:**\n1. Can you quantify the current state? (hours/week, error rate, etc.)\n2. What would success look like? What metrics would improve?\n3. Who else in the organization might have similar needs?\n\nWhen you're ready, I can help you structure this into a formal idea submission.`,
  ];

  return responses[Math.min(messageCount, responses.length - 1)];
}
