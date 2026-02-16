import { StaffGoal, InsertStaffGoal, GoalProgressEntry, InsertGoalProgressEntry } from "@shared/schema";

export interface IStaffGoalsService {
    // Staff Goals operations
    getStaffGoals(staffId: number, year?: number): Promise<StaffGoal[]>;
    getStaffGoalById(goalId: number): Promise<StaffGoal | undefined>;
    createStaffGoal(goal: InsertStaffGoal): Promise<StaffGoal>;
    updateStaffGoal(goalId: number, goal: Partial<InsertStaffGoal>): Promise<StaffGoal | undefined>;
    deleteStaffGoal(goalId: number): Promise<boolean>;
    getGoalProgressEntries(goalId: number): Promise<GoalProgressEntry[]>;
    createGoalProgressEntry(entry: InsertGoalProgressEntry): Promise<GoalProgressEntry>;
    deleteGoalProgressEntry(entryId: number): Promise<boolean>;
}