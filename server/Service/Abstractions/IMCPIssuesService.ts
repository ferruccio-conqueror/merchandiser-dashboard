export interface IMCPIssuesService {
    // MCP Issues operations
    getColorPanelIssues(colorPanelId: number): Promise<any[]>;
    createColorPanelIssue(issue: any): Promise<any>;
    updateColorPanelIssue(id: number, issue: any): Promise<any | undefined>;
}