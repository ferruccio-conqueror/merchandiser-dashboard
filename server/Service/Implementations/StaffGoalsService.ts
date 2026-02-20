import { goalProgressEntries, GoalProgressEntry, InsertGoalProgressEntry, InsertStaffGoal, StaffGoal, staffGoals } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IStaffGoalsService } from "../Abstractions/IStaffGoalsService";

export class StaffGoalsService implements IStaffGoalsService {

    // Staff Goals operations
    async getStaffGoals(staffId: number, year?: number): Promise<StaffGoal[]> {
        const conditions = [eq(staffGoals.staffId, staffId)];
        if (year) {
            conditions.push(eq(staffGoals.reviewYear, year));
        }
        return db.select().from(staffGoals).where(and(...conditions)).orderBy(staffGoals.priority);
    }

    async getStaffGoalById(goalId: number): Promise<StaffGoal | undefined> {
        const result = await db.select().from(staffGoals).where(eq(staffGoals.id, goalId));
        return result[0];
    }

    async createStaffGoal(goal: InsertStaffGoal): Promise<StaffGoal> {
        const result = await db.insert(staffGoals).values(goal).returning();
        return result[0];
    }

    async updateStaffGoal(goalId: number, goal: Partial<InsertStaffGoal>): Promise<StaffGoal | undefined> {
        const result = await db
            .update(staffGoals)
            .set({ ...goal, updatedAt: new Date() })
            .where(eq(staffGoals.id, goalId))
            .returning();
        return result[0];
    }

    async deleteStaffGoal(goalId: number): Promise<boolean> {
        // First delete all progress entries for this goal
        await db.delete(goalProgressEntries).where(eq(goalProgressEntries.goalId, goalId));
        // Then delete the goal itself
        const result = await db.delete(staffGoals).where(eq(staffGoals.id, goalId)).returning();
        return result.length > 0;
    }

    async getGoalProgressEntries(goalId: number): Promise<GoalProgressEntry[]> {
        return db.select().from(goalProgressEntries).where(eq(goalProgressEntries.goalId, goalId)).orderBy(desc(goalProgressEntries.entryDate));
    }

    async createGoalProgressEntry(entry: InsertGoalProgressEntry): Promise<GoalProgressEntry> {
        const result = await db.insert(goalProgressEntries).values(entry).returning();
        return result[0];
    }

    async deleteGoalProgressEntry(entryId: number): Promise<boolean> {
        const result = await db.delete(goalProgressEntries).where(eq(goalProgressEntries.id, entryId)).returning();
        return result.length > 0;
    }


}