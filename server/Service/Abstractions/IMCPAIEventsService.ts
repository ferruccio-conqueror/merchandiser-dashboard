export interface IMCPAIEventsService {
    // MCP AI Events operations
    getColorPanelAiEvents(colorPanelId: number): Promise<any[]>;
    createColorPanelAiEvent(event: any): Promise<any>;
    updateColorPanelAiEvent(id: number, event: any): Promise<any | undefined>;
}