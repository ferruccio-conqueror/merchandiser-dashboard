import { Timeline, InsertTimeline } from "@shared/schema";

export interface ITimelineOperationsService {
    // Timeline operations
    getTimelinesByPoId(poId: number): Promise<Timeline[]>;
    createTimeline(timeline: InsertTimeline): Promise<Timeline>;
    updateTimeline(id: number, timeline: Partial<InsertTimeline>): Promise<Timeline | undefined>;
}