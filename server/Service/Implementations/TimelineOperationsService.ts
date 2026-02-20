import { Timeline, InsertTimeline, timelines } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { ITimelineOperationsService } from "../Abstractions/ITimelineOperationsService";

export class TimelineOperationsService implements ITimelineOperationsService {

    async getTimelinesByPoId(poId: number): Promise<Timeline[]> {
        return db
            .select()
            .from(timelines)
            .where(eq(timelines.poId, poId))
            .orderBy(timelines.plannedDate);
    }

    async createTimeline(timeline: InsertTimeline): Promise<Timeline> {
        const result = await db
            .insert(timelines)
            .values(timeline as any)
            .returning();
        
        return result[0];
    }

    async updateTimeline(id: number, timeline: Partial<InsertTimeline>): Promise<Timeline | undefined> {
        const result = await db
            .update(timelines)
            .set({ ...timeline, updatedAt: new Date() })
            .where(eq(timelines.id, id))
            .returning();
        
        return result[0];
    }
}