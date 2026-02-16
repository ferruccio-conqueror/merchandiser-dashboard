export interface IMCPWorkflowService {
    // MCP Workflow operations
    getColorPanelWorkflow(colorPanelId: number): Promise<any | undefined>;
    createColorPanelWorkflow(workflow: any): Promise<any>;
    updateColorPanelWorkflow(colorPanelId: number, workflow: any): Promise<any | undefined>;
}