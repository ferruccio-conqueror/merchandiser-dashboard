import { PoTimeline, PoTimelineMilestone } from "@shared/schema";

export interface IPOTimelineService {
    // PO Timeline operations
    getPoTimelineByPoId(poId: number): Promise<{
        timeline: PoTimeline | null;
        milestones: PoTimelineMilestone[];
    }>;
    createPoTimeline(poId: number, templateId?: number): Promise<PoTimeline>;
    updatePoTimelineMilestone(id: number, data: { revisedDate?: Date | null; actualDate?: Date | null; actualSource?: string | null; notes?: string | null }): Promise<PoTimelineMilestone | undefined>;
    lockPoTimeline(poId: number, lockedBy: string): Promise<PoTimeline | undefined>;
    syncPoTimelineActuals(poId: number): Promise<PoTimelineMilestone[]>;
    initializePoTimelineFromTemplate(poId: number, templateId: number, poDate: Date): Promise<PoTimelineMilestone[]>;
    getAtRiskTimelineMilestones(client?: string, daysThreshold?: number): Promise<Array<{
        id: number;
        milestone: string;
        poId: number;
        poNumber: string;
        vendor: string | null;
        targetDate: Date;
        daysUntilDue: number;
        status: 'at-risk' | 'overdue';
    }>>;
}   