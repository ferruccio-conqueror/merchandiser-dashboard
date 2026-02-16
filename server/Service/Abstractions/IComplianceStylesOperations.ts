export interface IComplianceStylesOperations {
    // Compliance Styles operations (OS630 source data - separate table)
    bulkInsertComplianceStyles(styles: any[]): Promise<{ inserted: number }>;
    clearComplianceStyles(): Promise<void>;
}