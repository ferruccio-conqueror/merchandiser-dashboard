export interface IMCPMessagesService {
    // MCP Messages operations
    getColorPanelMessages(communicationId: number): Promise<any[]>;
    createColorPanelMessage(message: any): Promise<any>;
}