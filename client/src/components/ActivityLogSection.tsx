import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { Plus, Check, Clock, FileText, AlertCircle } from "lucide-react";
import type { ActivityLog } from "@shared/schema";

interface ActivityLogSectionProps {
  entityType: 'po' | 'sku';
  entityId: string;
  title?: string;
}

export function ActivityLogSection({ entityType, entityId, title = "Activity Log" }: ActivityLogSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [newLog, setNewLog] = useState({
    logType: 'update' as 'action' | 'update',
    description: '',
    dueDate: '',
  });

  const { data: logs, isLoading } = useQuery<ActivityLog[]>({
    queryKey: ['/api/activity-logs', entityType, entityId],
    queryFn: async () => {
      const response = await fetch(`/api/activity-logs/${entityType}/${entityId}`);
      if (!response.ok) throw new Error('Failed to fetch activity logs');
      return response.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { entityType: string; entityId: string; logType: string; description: string; dueDate?: string }) => {
      return apiRequest('POST', '/api/activity-logs', {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/activity-logs', entityType, entityId] });
      setIsAdding(false);
      setNewLog({ logType: 'update', description: '', dueDate: '' });
      toast({ title: "Activity logged successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create log", description: error.message, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('PATCH', `/api/activity-logs/${id}/complete`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/activity-logs', entityType, entityId] });
      queryClient.invalidateQueries({ queryKey: ['/api/my-tasks'] });
      toast({ title: "Action marked as complete" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to complete action", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!newLog.description.trim()) {
      toast({ title: "Description required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      entityType,
      entityId,
      logType: newLog.logType,
      description: newLog.description,
      dueDate: newLog.dueDate || undefined,
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        <Button 
          size="sm" 
          variant={isAdding ? "outline" : "default"}
          onClick={() => setIsAdding(!isAdding)}
          data-testid="button-add-activity"
        >
          {isAdding ? "Cancel" : <><Plus className="h-4 w-4 mr-1" /> Add Entry</>}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdding && (
          <div className="space-y-4 p-4 border rounded-lg bg-muted/50" data-testid="form-add-activity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select 
                  value={newLog.logType} 
                  onValueChange={(value: 'action' | 'update') => setNewLog(prev => ({ ...prev, logType: value }))}
                >
                  <SelectTrigger data-testid="select-log-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="update">Update / Note</SelectItem>
                    <SelectItem value="action">Action Required</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newLog.logType === 'action' && (
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input
                    type="date"
                    value={newLog.dueDate}
                    onChange={(e) => setNewLog(prev => ({ ...prev, dueDate: e.target.value }))}
                    data-testid="input-due-date"
                  />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Enter your note or action description..."
                value={newLog.description}
                onChange={(e) => setNewLog(prev => ({ ...prev, description: e.target.value }))}
                className="min-h-[80px]"
                data-testid="textarea-description"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button 
                variant="outline" 
                onClick={() => setIsAdding(false)}
                data-testid="button-cancel-activity"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit}
                disabled={createMutation.isPending}
                data-testid="button-save-activity"
              >
                {createMutation.isPending ? "Saving..." : "Save Entry"}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : logs && logs.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[100px]">Due Date</TableHead>
                  <TableHead className="w-[100px]">Created</TableHead>
                  <TableHead className="w-[120px]">Created By</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-activity-${log.id}`}>
                    <TableCell>
                      {log.logType === 'action' ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Action
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <FileText className="h-3 w-3 mr-1" />
                          Note
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[400px]">
                      <span className={log.isCompleted ? "line-through text-muted-foreground" : ""}>
                        {log.description}
                      </span>
                    </TableCell>
                    <TableCell>
                      {log.dueDate ? (
                        <span className={`text-sm ${
                          !log.isCompleted && new Date(log.dueDate) < new Date() 
                            ? 'text-red-600 font-medium' 
                            : 'text-muted-foreground'
                        }`}>
                          {format(new Date(log.dueDate), 'MMM d, yyyy')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.createdAt ? format(new Date(log.createdAt), 'MMM d') : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[120px]">
                      {log.createdBy || '—'}
                    </TableCell>
                    <TableCell>
                      {log.logType === 'action' ? (
                        log.isCompleted ? (
                          <Badge variant="secondary" className="bg-green-50 text-green-700">
                            <Check className="h-3 w-3 mr-1" />
                            Done
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => completeMutation.mutate(log.id)}
                            disabled={completeMutation.isPending}
                            className="h-7 text-xs"
                            data-testid={`button-complete-${log.id}`}
                          >
                            <Clock className="h-3 w-3 mr-1" />
                            Complete
                          </Button>
                        )
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-activities">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No activity logs yet</p>
            <p className="text-sm">Click "Add Entry" to record notes or actions</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
