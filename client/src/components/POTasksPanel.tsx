import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { 
  CheckCircle2, 
  Circle, 
  Clock, 
  AlertCircle, 
  Plus, 
  RefreshCw, 
  ClipboardList,
  Ship,
  FileSearch,
  ShieldCheck,
  PenLine,
  Trash2,
  Calendar,
  Milestone
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PoTask } from "@shared/schema";

interface POTasksPanelProps {
  poNumber: string;
}

const sourceIcons: Record<string, typeof ClipboardList> = {
  compliance: ShieldCheck,
  inspection: FileSearch,
  shipment: Ship,
  manual: PenLine,
  timeline: Milestone,
};

const sourceLabels: Record<string, string> = {
  compliance: "Compliance",
  inspection: "Inspection",
  shipment: "Shipment",
  manual: "Manual Task",
  timeline: "Timeline",
};

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500 dark:bg-red-600 text-white",
  high: "bg-orange-500 dark:bg-orange-600 text-white",
  normal: "bg-blue-500 dark:bg-blue-600 text-white",
  low: "bg-gray-400 dark:bg-gray-500 text-white",
};

export function POTasksPanel({ poNumber }: POTasksPanelProps) {
  const { toast } = useToast();
  const [showCompleted, setShowCompleted] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    priority: "normal",
    dueDate: "",
  });

  const { data: tasks = [], isLoading, refetch } = useQuery<PoTask[]>({
    queryKey: [`/api/purchase-orders/${poNumber}/tasks?includeCompleted=${showCompleted}`],
  });

  const invalidateTasks = () => {
    queryClient.invalidateQueries({ 
      predicate: (query) => 
        (query.queryKey[0] as string)?.startsWith(`/api/purchase-orders/${poNumber}/tasks`)
    });
  };

  const generateTasksMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/purchase-orders/${poNumber}/tasks/generate`, {});
      return response.json() as Promise<{ generated: number; tasks: PoTask[] }>;
    },
    onSuccess: (data) => {
      invalidateTasks();
      toast({
        title: "Tasks Generated",
        description: `${data.generated} new task(s) created from PO data.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to generate tasks",
        variant: "destructive",
      });
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (task: typeof newTask) => {
      return apiRequest("POST", `/api/purchase-orders/${poNumber}/tasks`, {
        ...task,
        taskSource: "manual",
        taskType: "custom",
        dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
      });
    },
    onSuccess: () => {
      invalidateTasks();
      setIsAddingTask(false);
      setNewTask({ title: "", description: "", priority: "normal", dueDate: "" });
      toast({
        title: "Task Created",
        description: "New task has been added.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create task",
        variant: "destructive",
      });
    },
  });

  const completeTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      return apiRequest("PATCH", `/api/po-tasks/${taskId}/complete`, {});
    },
    onSuccess: () => {
      invalidateTasks();
      toast({
        title: "Task Completed",
        description: "Task marked as complete.",
      });
    },
  });

  const uncompleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      return apiRequest("PATCH", `/api/po-tasks/${taskId}/uncomplete`, {});
    },
    onSuccess: () => {
      invalidateTasks();
      toast({
        title: "Task Reopened",
        description: "Task marked as incomplete.",
      });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      return apiRequest("DELETE", `/api/po-tasks/${taskId}`, {});
    },
    onSuccess: () => {
      invalidateTasks();
      toast({
        title: "Task Deleted",
        description: "Task has been removed.",
      });
    },
  });

  const handleToggleComplete = (task: PoTask) => {
    if (task.isCompleted) {
      uncompleteTaskMutation.mutate(task.id);
    } else {
      completeTaskMutation.mutate(task.id);
    }
  };

  const pendingTasks = tasks.filter(t => !t.isCompleted);
  const completedTasks = tasks.filter(t => t.isCompleted);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              PO Tasks
            </CardTitle>
            <CardDescription>
              Tasks and follow-ups for this purchase order
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateTasksMutation.mutate()}
              disabled={generateTasksMutation.isPending}
              data-testid="button-generate-tasks"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${generateTasksMutation.isPending ? 'animate-spin' : ''}`} />
              Generate Tasks
            </Button>
            <Dialog open={isAddingTask} onOpenChange={setIsAddingTask}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-task">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Task
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Task</DialogTitle>
                  <DialogDescription>
                    Create a manual task for this purchase order
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="task-title">Title</Label>
                    <Input
                      id="task-title"
                      value={newTask.title}
                      onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                      placeholder="Enter task title"
                      data-testid="input-task-title"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="task-description">Description</Label>
                    <Textarea
                      id="task-description"
                      value={newTask.description}
                      onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                      placeholder="Enter task details (optional)"
                      data-testid="input-task-description"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="task-priority">Priority</Label>
                      <Select
                        value={newTask.priority}
                        onValueChange={(value) => setNewTask({ ...newTask, priority: value })}
                      >
                        <SelectTrigger data-testid="select-task-priority">
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="task-due-date">Due Date</Label>
                      <Input
                        id="task-due-date"
                        type="date"
                        value={newTask.dueDate}
                        onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                        data-testid="input-task-due-date"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddingTask(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createTaskMutation.mutate(newTask)}
                    disabled={!newTask.title.trim() || createTaskMutation.isPending}
                    data-testid="button-save-task"
                  >
                    Create Task
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {pendingTasks.length} pending task{pendingTasks.length !== 1 ? 's' : ''}
            </span>
            {completedTasks.length > 0 && (
              <span className="text-sm text-muted-foreground">
                • {completedTasks.length} completed
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-completed"
              checked={showCompleted}
              onCheckedChange={setShowCompleted}
              data-testid="switch-show-completed"
            />
            <Label htmlFor="show-completed" className="text-sm text-muted-foreground">
              Show Completed
            </Label>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="text-center py-8">
            <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No tasks found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click "Generate Tasks" to create tasks from PO data or add a manual task
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const SourceIcon = sourceIcons[task.taskSource] || ClipboardList;
              const isOverdue = task.dueDate && !task.isCompleted && new Date(task.dueDate) < new Date();
              
              return (
                <div
                  key={task.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    task.isCompleted ? 'bg-muted/50 opacity-75' : ''
                  } ${isOverdue ? 'border-red-300 bg-red-50 dark:bg-red-950/20' : ''}`}
                  data-testid={`task-item-${task.id}`}
                >
                  <Checkbox
                    checked={task.isCompleted}
                    onCheckedChange={() => handleToggleComplete(task)}
                    className="mt-1"
                    data-testid={`checkbox-task-${task.id}`}
                  />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-medium ${task.isCompleted ? 'line-through text-muted-foreground' : ''}`}>
                        {task.title}
                      </span>
                      <Badge variant="outline" className="text-xs gap-1">
                        <SourceIcon className="h-3 w-3" />
                        {sourceLabels[task.taskSource] || task.taskSource}
                      </Badge>
                      <Badge className={`text-xs ${priorityColors[task.priority || 'normal']}`}>
                        {task.priority || 'normal'}
                      </Badge>
                    </div>
                    
                    {task.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {task.description}
                      </p>
                    )}
                    
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      {task.dueDate && (
                        <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                          <Calendar className="h-3 w-3" />
                          Due: {format(new Date(task.dueDate), "MM/dd/yyyy")}
                          {isOverdue && <AlertCircle className="h-3 w-3" />}
                        </span>
                      )}
                      
                      {task.isCompleted && task.completedAt && (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="h-3 w-3" />
                          Completed: {format(new Date(task.completedAt), "MM/dd/yyyy")}
                          {task.completedBy && ` by ${task.completedBy}`}
                        </span>
                      )}
                      
                      {task.createdBy && !task.isCompleted && (
                        <span>Created by: {task.createdBy}</span>
                      )}
                    </div>
                  </div>
                  
                  {task.taskSource === 'manual' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteTaskMutation.mutate(task.id)}
                      data-testid={`button-delete-task-${task.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
