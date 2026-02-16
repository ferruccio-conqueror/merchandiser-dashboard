import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Send,
  Bot,
  User,
  Sparkles,
  X,
  Maximize2,
  Minimize2,
  Download,
  FileSpreadsheet,
  FileText,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Package,
  Ship,
  Factory,
  Trash2,
  Database,
  ChevronDown,
  ChevronUp,
  Clock,
  Code,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

interface QueryResult {
  query: string;
  reasoning: string;
  success: boolean;
  rowCount?: number;
  executionTimeMs?: number;
  data?: Record<string, unknown>[];
  error?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  reportData?: ReportData;
  queries?: QueryResult[];
}

interface ReportData {
  type: "table" | "summary" | "trend" | "alert";
  title: string;
  data: Record<string, unknown>[];
  columns?: string[];
  insights?: string[];
}

interface ChatResponse {
  message: string;
  reportData?: ReportData;
  queries?: QueryResult[];
  analytics?: {
    trueOTD?: number;
    lateOrders?: number;
    avgDaysLate?: number;
    queriesExecuted?: number;
    totalRows?: number;
  };
}

const SUGGESTED_QUESTIONS = [
  {
    icon: TrendingUp,
    question: "Show me vendors with declining OTD over the last 6 months",
    category: "Trends",
  },
  {
    icon: AlertTriangle,
    question: "Which POs are past their cancel date and still unshipped?",
    category: "Late POs",
  },
  {
    icon: Package,
    question: "What is our total shipped value by month this year?",
    category: "Revenue",
  },
  {
    icon: Factory,
    question: "Show me the top 10 vendors by order value",
    category: "Analysis",
  },
  {
    icon: Ship,
    question: "Which SKUs have the most orders in the last 90 days?",
    category: "Products",
  },
  {
    icon: BarChart3,
    question: "Compare OTD performance between Vietnam and China offices",
    category: "Reports",
  },
];

interface AIAssistantSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIAssistantSidebar({ isOpen, onClose }: AIAssistantSidebarProps) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      // Use the SQL-powered endpoint for direct database access
      const response = await apiRequest("POST", "/api/ai/analyst/sql-chat", {
        message,
        conversationHistory: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
      return (await response.json()) as ChatResponse;
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "assistant",
          content: data.message,
          timestamp: new Date().toISOString(),
          reportData: data.reportData,
          queries: data.queries,
        },
      ]);
    },
    onError: (error: Error) => {
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "assistant",
          content: `I encountered an error while analyzing. ${error.message}. Please try again.`,
          timestamp: new Date().toISOString(),
        },
      ]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;

    const userMessage = input.trim();
    setMessages((prev) => [
      ...prev,
      {
        id: generateId(),
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      },
    ]);
    setInput("");
    chatMutation.mutate(userMessage);
  };

  const handleSuggestedQuestion = (question: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: generateId(),
        role: "user",
        content: question,
        timestamp: new Date().toISOString(),
      },
    ]);
    chatMutation.mutate(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearConversation = () => {
    setMessages([]);
  };

  const handleExportExcel = async (reportData?: ReportData) => {
    try {
      const response = await apiRequest("POST", "/api/ai/analyst/export/excel", {
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
        reportData,
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-analysis-${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  const handleExportPDF = async (reportData?: ReportData) => {
    try {
      const response = await apiRequest("POST", "/api/ai/analyst/export/pdf", {
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        })),
        reportData,
      });

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-analysis-${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  if (!isOpen) return null;

  const containerClasses = isFullScreen
    ? "fixed inset-0 z-50 bg-background"
    : "fixed right-0 top-0 h-screen w-[480px] z-50 border-l bg-background shadow-xl";

  return (
    <div className={containerClasses} data-testid="ai-assistant-sidebar">
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-sm">AI Data Analyst</h2>
              <p className="text-xs text-muted-foreground">
                Sourcing & Shipping Intelligence
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={messages.length === 0}
                  data-testid="button-export-dropdown"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExportExcel()} data-testid="button-export-excel">
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export as Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportPDF()} data-testid="button-export-pdf">
                  <FileText className="h-4 w-4 mr-2" />
                  Export as PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearConversation}
              disabled={messages.length === 0}
              data-testid="button-clear-conversation"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsFullScreen(!isFullScreen)}
              data-testid="button-toggle-fullscreen"
            >
              {isFullScreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              data-testid="button-close-ai-sidebar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="space-y-6">
                <div className="text-center py-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
                    <Bot className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">
                    AI Data Analyst
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    I have direct database access and can run SQL queries to answer
                    any question about your data. Ask me anything about POs, vendors,
                    shipments, projections, or SKUs.
                  </p>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
                    Quick Analysis
                  </p>
                  <div className={`grid gap-2 ${isFullScreen ? "grid-cols-3" : "grid-cols-2"}`}>
                    {SUGGESTED_QUESTIONS.map((item, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        className="h-auto p-3 flex flex-col items-start gap-2 text-left"
                        onClick={() => handleSuggestedQuestion(item.question)}
                        disabled={chatMutation.isPending}
                        data-testid={`button-suggested-${index}`}
                      >
                        <div className="flex items-center gap-2">
                          <item.icon className="h-4 w-4 text-primary" />
                          <Badge variant="secondary" className="text-xs">
                            {item.category}
                          </Badge>
                        </div>
                        <span className="text-xs line-clamp-2">{item.question}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    <Database className="h-4 w-4 text-primary" />
                    Direct Database Access
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-1.5">
                    <li className="flex items-start gap-2">
                      <Code className="h-3 w-3 mt-0.5 text-green-500" />
                      Run custom queries on POs, vendors, shipments
                    </li>
                    <li className="flex items-start gap-2">
                      <BarChart3 className="h-3 w-3 mt-0.5 text-blue-500" />
                      Analyze trends across any time period
                    </li>
                    <li className="flex items-start gap-2">
                      <TrendingUp className="h-3 w-3 mt-0.5 text-amber-500" />
                      Discover patterns in quality, delivery, projections
                    </li>
                    <li className="flex items-start gap-2">
                      <Package className="h-3 w-3 mt-0.5 text-purple-500" />
                      Generate ad-hoc reports not in standard dashboards
                    </li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                    data-testid={`message-${message.role}-${message.id}`}
                  >
                    {message.role === "assistant" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div
                      className={`rounded-lg max-w-[85%] ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground px-4 py-2"
                          : "bg-muted px-4 py-3"
                      }`}
                    >
                      <div className="text-sm whitespace-pre-wrap">
                        {message.content}
                      </div>
                      {message.queries && message.queries.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border/50">
                          <QueryDisplay queries={message.queries} />
                        </div>
                      )}
                      {message.reportData && (
                        <div className="mt-3 pt-3 border-t border-border/50">
                          <ReportDisplay
                            reportData={message.reportData}
                            onExportExcel={() => handleExportExcel(message.reportData)}
                            onExportPDF={() => handleExportPDF(message.reportData)}
                          />
                        </div>
                      )}
                    </div>
                    {message.role === "user" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                        <User className="h-4 w-4 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                ))}
                {chatMutation.isPending && (
                  <div className="flex gap-3 justify-start">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="bg-muted rounded-lg px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">
                          Querying database and analyzing...
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <div className="p-4 border-t bg-background">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about shipping trends, vendor performance..."
                disabled={chatMutation.isPending}
                className="flex-1"
                data-testid="input-ai-analyst-message"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || chatMutation.isPending}
                size="icon"
                data-testid="button-send-ai-analyst"
              >
                {chatMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportDisplay({
  reportData,
  onExportExcel,
  onExportPDF,
}: {
  reportData: ReportData;
  onExportExcel: () => void;
  onExportPDF: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-sm">{reportData.title}</h4>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onExportExcel}
            className="h-7 px-2"
            data-testid="button-export-report-excel"
          >
            <FileSpreadsheet className="h-3 w-3 mr-1" />
            Excel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onExportPDF}
            className="h-7 px-2"
            data-testid="button-export-report-pdf"
          >
            <FileText className="h-3 w-3 mr-1" />
            PDF
          </Button>
        </div>
      </div>

      {reportData.type === "table" && reportData.columns && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                {reportData.columns.map((col, i) => (
                  <th key={i} className="text-left py-2 px-2 font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reportData.data.slice(0, 10).map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {reportData.columns!.map((col, j) => (
                    <td key={j} className="py-2 px-2">
                      {String(row[col] ?? "-")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {reportData.data.length > 10 && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing 10 of {reportData.data.length} rows. Export for full data.
            </p>
          )}
        </div>
      )}

      {reportData.type === "summary" && reportData.insights && (
        <div className="space-y-2">
          {reportData.insights.map((insight, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs bg-background/50 rounded p-2"
            >
              <CheckCircle className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" />
              <span>{insight}</span>
            </div>
          ))}
        </div>
      )}

      {reportData.type === "trend" && (
        <div className="flex items-center gap-4 text-xs">
          {reportData.data.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              {(item.direction as string) === "up" ? (
                <TrendingUp className="h-3 w-3 text-green-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              <span className="font-medium">{String(item.label)}</span>
              <span className="text-muted-foreground">{String(item.value)}</span>
            </div>
          ))}
        </div>
      )}

      {reportData.type === "alert" && (
        <div className="space-y-2">
          {reportData.data.map((alert, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded p-2"
            >
              <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-500 flex-shrink-0" />
              <div>
                <span className="font-medium">{String(alert.title ?? "")}</span>
                {alert.description ? (
                  <p className="text-muted-foreground mt-0.5">
                    {String(alert.description)}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QueryDisplay({ queries }: { queries: QueryResult[] }) {
  const [expandedQueries, setExpandedQueries] = useState<Set<number>>(new Set());

  const toggleQuery = (index: number) => {
    setExpandedQueries(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Database className="h-3 w-3" />
        <span>{queries.length} SQL {queries.length === 1 ? 'query' : 'queries'} executed</span>
      </div>
      {queries.map((query, index) => (
        <div key={index} className="bg-background/50 rounded border border-border/50 overflow-hidden">
          <button
            onClick={() => toggleQuery(index)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs hover-elevate"
            data-testid={`button-toggle-query-${index}`}
          >
            <div className="flex items-center gap-2">
              <Code className="h-3 w-3 text-primary" />
              <span className="font-medium">Query {index + 1}</span>
              {query.success ? (
                <Badge variant="secondary" className="text-[10px] h-4 px-1">
                  {query.rowCount} rows
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-[10px] h-4 px-1">
                  Error
                </Badge>
              )}
              {query.executionTimeMs && (
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-2 w-2" />
                  {query.executionTimeMs}ms
                </span>
              )}
            </div>
            {expandedQueries.has(index) ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
          {expandedQueries.has(index) && (
            <div className="border-t border-border/50 p-3 space-y-2">
              {query.reasoning && (
                <div className="text-xs text-muted-foreground italic">
                  {query.reasoning}
                </div>
              )}
              <pre className="text-[10px] bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap font-mono">
                {query.query}
              </pre>
              {query.error && (
                <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded">
                  {query.error}
                </div>
              )}
              {query.data && query.data.length > 0 && (
                <div className="text-[10px] overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-border/50">
                        {Object.keys(query.data[0]).slice(0, 6).map((col, i) => (
                          <th key={i} className="text-left py-1 px-2 font-medium text-muted-foreground">
                            {col}
                          </th>
                        ))}
                        {Object.keys(query.data[0]).length > 6 && (
                          <th className="text-left py-1 px-2 font-medium text-muted-foreground">...</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.slice(0, 5).map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-border/30">
                          {Object.values(row).slice(0, 6).map((val, colIndex) => (
                            <td key={colIndex} className="py-1 px-2 max-w-[100px] truncate">
                              {val === null ? <span className="text-muted-foreground">null</span> : String(val)}
                            </td>
                          ))}
                          {Object.keys(row).length > 6 && (
                            <td className="py-1 px-2 text-muted-foreground">...</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {query.data.length > 5 && (
                    <div className="text-muted-foreground text-center py-1">
                      + {query.data.length - 5} more rows
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
