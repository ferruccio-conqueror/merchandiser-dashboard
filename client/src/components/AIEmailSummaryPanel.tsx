import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, RefreshCw, MessageSquare, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

type EntityType = "shipment" | "purchase_order" | "mcp" | "sku" | "compliance";

interface AiSummary {
  id: number;
  entityType: string;
  entityId: number;
  summaryType: string;
  summary: string;
  keyEvents: string;
  recommendations: string | null;
  generatedAt: string;
  isStale: boolean;
}

interface AIEmailSummaryPanelProps {
  entityType: EntityType;
  entityId: number;
  poNumber?: string;
  title?: string;
  className?: string;
  testIdPrefix?: string;
}

export function AIEmailSummaryPanel({
  entityType,
  entityId,
  poNumber,
  title = "AI Email History Summary",
  className = "",
  testIdPrefix = "ai-summary",
}: AIEmailSummaryPanelProps) {
  const { toast } = useToast();

  const queryKey = ["/api/ai-summaries", entityType, entityId, "email_history"];

  const { data: aiSummary, isLoading: summaryLoading, error: summaryError } = useQuery<AiSummary>({
    queryKey,
    enabled: entityId > 0,
  });

  const generateSummaryMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/ai-summaries/generate", {
        entityType,
        entityId,
        summaryType: "email_history",
        poNumber,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({
        title: "Summary Generated",
        description: "AI summary has been generated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Generation Failed",
        description: "Failed to generate AI summary. Please try again.",
        variant: "destructive",
      });
    },
  });

  const parsedKeyEvents = aiSummary?.keyEvents
    ? (() => {
        try {
          return JSON.parse(aiSummary.keyEvents);
        } catch {
          return [];
        }
      })()
    : [];

  const getEntityLabel = () => {
    switch (entityType) {
      case "shipment":
        return "shipment";
      case "purchase_order":
        return "purchase order";
      case "mcp":
        return "Master Color Panel";
      case "sku":
        return "SKU";
      case "compliance":
        return "compliance record";
      default:
        return "entity";
    }
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {summaryLoading ? (
          <Skeleton className="h-32" />
        ) : summaryError ? (
          <div className="text-center py-6">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive mb-3" data-testid={`${testIdPrefix}-error`}>
              Failed to load AI summary. Please try again.
            </p>
            <Button
              variant="outline"
              onClick={() => queryClient.invalidateQueries({ queryKey })}
              data-testid={`${testIdPrefix}-retry-button`}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : aiSummary ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm leading-relaxed" data-testid={`${testIdPrefix}-text`}>
                {aiSummary.summary}
              </p>
              {aiSummary.isStale && (
                <Badge variant="outline" className="mt-2 text-xs text-orange-600 dark:text-orange-400">
                  Summary may be outdated
                </Badge>
              )}
            </div>

            {parsedKeyEvents.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Key Events</h4>
                <ul className="space-y-2">
                  {parsedKeyEvents.slice(0, 5).map((event: any, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground text-xs mt-0.5">{event.date}</span>
                      <span>{event.event}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {aiSummary.recommendations && (
              <div>
                <h4 className="text-sm font-medium mb-1">Recommendations</h4>
                <p className="text-sm text-muted-foreground">{aiSummary.recommendations}</p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateSummaryMutation.mutate()}
                disabled={generateSummaryMutation.isPending}
                data-testid={`${testIdPrefix}-regenerate-button`}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${generateSummaryMutation.isPending ? 'animate-spin' : ''}`} />
                Regenerate
              </Button>
              <span className="text-xs text-muted-foreground">
                Generated {aiSummary.generatedAt ? format(new Date(aiSummary.generatedAt), "MMM dd, yyyy HH:mm") : "N/A"}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <MessageSquare className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              No AI summary available for this {getEntityLabel()}.
            </p>
            <Button
              onClick={() => generateSummaryMutation.mutate()}
              disabled={generateSummaryMutation.isPending}
              data-testid={`${testIdPrefix}-generate-button`}
            >
              <Sparkles className={`h-4 w-4 mr-2 ${generateSummaryMutation.isPending ? 'animate-spin' : ''}`} />
              {generateSummaryMutation.isPending ? "Generating..." : "Generate AI Summary"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
