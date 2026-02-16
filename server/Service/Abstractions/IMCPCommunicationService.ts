export interface IMCPCommunicationService {
    // MCP Communications operations
    getColorPanelCommunications(colorPanelId: number): Promise<any[]>;
    createColorPanelCommunication(communication: any): Promise<any>;
    updateColorPanelCommunication(id: number, communication: any): Promise<any | undefined>;
}