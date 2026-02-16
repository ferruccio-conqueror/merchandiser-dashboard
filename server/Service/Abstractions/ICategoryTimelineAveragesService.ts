import { CategoryTimelineAverage } from "@shared/schema";

export interface ICategoryTimelineAveragesService {
    // Category Timeline Averages operations
    getCategoryTimelineAverages(): Promise<CategoryTimelineAverage[]>;
    recalculateCategoryTimelineAverages(): Promise<void>;
    getTimelineGenerationPreview(): Promise<{
        totalPOs: number;
        posWithTimelines: number;
        posWithoutTimelines: number;
        byCategory: { category: string; count: number; hasAverages: boolean }[];
    }>;

    bulkGenerateTimelinesFromCategoryAverages(dryRun: boolean, limit: number): Promise<{
        success: boolean;
        timelinesCreated: number;
        milestonesCreated: number;
        errors: string[];
        dryRun: boolean;
    }>;
}