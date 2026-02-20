import { poHeaders, PurchaseOrder, Shipment, shipments } from "@shared/schema";
import { eq, and, desc, sql, inArray, SQL, gte, lte, or, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { IShipmentWithPODataService } from "../Abstractions/IShipmentsWithPODataService";

export class ShipmentWithPODataService implements IShipmentWithPODataService {


    // Shipments with PO data for Shipments page
    // Pulls from shipments table (OS650) if available, otherwise generates from purchase_orders (OS340)
    // Includes at-risk status calculation based on business rules
    async getShipmentsWithPoData(filters?: {
        vendor?: string;
        office?: string;
        status?: string;
        startDate?: Date;
        endDate?: Date;
        client?: string;
        merchandiser?: string;
        merchandisingManager?: string;
        limit?: number;
        offset?: number;
        includeShipped?: boolean;
    }): Promise<(Shipment & { po?: PurchaseOrder; atRiskStatus?: boolean; atRiskReasons?: string[]; revisedReason?: string | null })[]> {
        // Apply default limit of 500 for performance (was loading all 41k records)
        const limit = filters?.limit ?? 500;
        const offset = filters?.offset ?? 0;

        // Build WHERE conditions for filtering
        const whereConditions: any[] = [];

        // Join with po_headers for filtering and vendors table for merchandiser/manager filtering
        // Same pattern as Dashboard operations filters
        let os650Shipments: (Shipment & { revisedReason?: string | null })[];

        // Build dynamic WHERE clause using drizzle sql template
        const conditions: ReturnType<typeof sql>[] = [];

        // By default, exclude shipped orders (those with actual_sailing_date OR delivery_to_consolidator)
        // Per business rules, an order is "shipped" when either field is populated
        // Unless includeShipped filter is true
        if (!filters?.includeShipped) {
            conditions.push(sql`(s.actual_sailing_date IS NULL AND s.delivery_to_consolidator IS NULL)`);
        }

        if (filters?.vendor) {
            // Match vendor by canonical name from vendors table or via aliases
            conditions.push(sql`(
            ph.vendor = ${filters.vendor}
            OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor}))
            OR ph.vendor IN (
              SELECT vca.alias FROM vendor_capacity_aliases vca
              JOIN vendors v ON vca.vendor_id = v.id
              WHERE v.name = ${filters.vendor}
            )
          )`);
        }
        if (filters?.office) {
            conditions.push(sql`ph.office = ${filters.office}`);
        }
        if (filters?.client) {
            // Look up full client name from clients table using the code
            conditions.push(sql`ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
        }
        // Merchandiser filtering via vendors table (same as Dashboard)
        if (filters?.merchandiser) {
            conditions.push(sql`v.merchandiser = ${filters.merchandiser}`);
        }
        // Merchandising Manager filtering via vendors table (same as Dashboard)
        if (filters?.merchandisingManager) {
            conditions.push(sql`(
            v.merchandising_manager = ${filters.merchandisingManager}
            OR v.merchandiser IN (
              SELECT m.name FROM staff m
              JOIN staff mgr ON m.manager_id = mgr.id
              WHERE mgr.name = ${filters.merchandisingManager}
            )
          )`);
        }
        // Date range filtering
        if (filters?.startDate) {
            conditions.push(sql`s.created_at >= ${filters.startDate.toISOString()}`);
        }
        if (filters?.endDate) {
            conditions.push(sql`s.created_at <= ${filters.endDate.toISOString()}`);
        }

        const whereClause = conditions.length > 0
            ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
            : sql``;


        const limitNum = Number(limit);
        const offsetNum = Number(offset);
        const result = await db.execute<any>(sql`
          SELECT s.*, ph.revised_reason FROM shipments s
          LEFT JOIN po_headers ph ON s.po_number = ph.po_number
          LEFT JOIN vendors v ON v.name = ph.vendor
          ${whereClause}
          ORDER BY s.cargo_ready_date DESC NULLS LAST, s.created_at DESC
          LIMIT ${limitNum} OFFSET ${offsetNum}
        `);

        os650Shipments = result.rows.map((row: any) => ({
            id: row.id,
            poId: row.po_id,
            poNumber: row.po_number,
            shipmentNumber: row.shipment_number,
            deliveryToConsolidator: row.delivery_to_consolidator,
            qtyShipped: row.qty_shipped,
            shippedValue: row.shipped_value,
            actualPortOfLoading: row.actual_port_of_loading,
            actualSailingDate: row.actual_sailing_date,
            eta: row.eta,
            actualShipMode: row.actual_ship_mode,
            poe: row.poe,
            vesselFlight: row.vessel_flight,
            cargoReadyDate: row.cargo_ready_date,
            loadType: row.load_type,
            ptsNumber: row.pts_number,
            logisticStatus: row.logistic_status,
            lateReasonCode: row.late_reason_code,
            hodStatus: row.hod_status,
            soFirstSubmissionDate: row.so_first_submission_date,
            ptsStatus: row.pts_status,
            cargoReceiptStatus: row.cargo_receipt_status,
            reason: row.reason,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lineItemId: row.line_item_id,
            style: row.style,
            revisedReason: row.revised_reason,
        }));

        if (os650Shipments.length > 0) {
            // Use OS650 shipments data
            const poNumbers = [...new Set(os650Shipments.map(s => s.poNumber).filter(Boolean))];
            const poMap = await this.getPurchaseOrdersByNumbers(poNumbers);

            // Get inspection data for all POs to check at-risk criteria
            // Build inspections map from existing data if we have PO numbers
            const inspectionMap = new Map<string, { has_inline_booked: boolean; has_final_booked: boolean }>();
            const qaMap = new Map<string, { has_passed_qa: boolean }>();

            if (poNumbers.length > 0) {
                // Query inspections for these PO numbers
                const inspectionData = await db.execute<{
                    po_number: string;
                    inspection_type: string;
                }>(sql`
              SELECT DISTINCT po_number, inspection_type
              FROM inspections
              WHERE po_number IN (${sql.join(poNumbers.map(p => sql`${p}`), sql`, `)})
            `);

                // Build inspection map
                for (const row of inspectionData.rows) {
                    if (!inspectionMap.has(row.po_number)) {
                        inspectionMap.set(row.po_number, { has_inline_booked: false, has_final_booked: false });
                    }
                    const entry = inspectionMap.get(row.po_number)!;
                    if (row.inspection_type?.toLowerCase().includes('inline')) {
                        entry.has_inline_booked = true;
                    }
                    if (row.inspection_type?.toLowerCase().includes('final')) {
                        entry.has_final_booked = true;
                    }
                }

                // Query QA test data - simpler approach, just check if any passed QA exists
                const qaTestData = await db.execute<{
                    po_number: string;
                    has_passed: boolean;
                }>(sql`
              SELECT DISTINCT 
                ph.po_number,
                EXISTS(
                  SELECT 1 FROM quality_tests qt 
                  JOIN skus s ON qt.sku_id = s.id 
                  WHERE s.sku = pli.sku AND qt.result = 'Pass'
                ) as has_passed
              FROM po_headers ph
              LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
              WHERE ph.po_number IN (${sql.join(poNumbers.map(p => sql`${p}`), sql`, `)})
            `);

                for (const row of qaTestData.rows) {
                    qaMap.set(row.po_number, { has_passed_qa: row.has_passed });
                }
            }

            const enrichedShipments = os650Shipments.map(shipment => {
                const po = poMap.get(shipment.poNumber);
                const inspections = inspectionMap.get(shipment.poNumber);
                const qa = qaMap.get(shipment.poNumber);

                // Calculate at-risk status based on business rules
                const atRiskReasons: string[] = [];
                const now = new Date();
                const hod = po?.revisedShipDate ? new Date(po.revisedShipDate) : null;

                // Only check at-risk for shipments that haven't shipped yet (hodStatus not On-Time, Late, or explicitly shipped)
                const isShipped = shipment.hodStatus === 'On Time' || shipment.hodStatus === 'On-Time' ||
                    shipment.hodStatus === 'Late' || shipment.hodStatus === 'Shipped';

                if (!isShipped && hod && hod > now) {
                    const daysUntilHod = Math.ceil((hod.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                    // 1. Inline inspection not booked 2 weeks before HOD
                    if (daysUntilHod <= 14 && !inspections?.has_inline_booked) {
                        atRiskReasons.push('Inline inspection not booked (due 2 weeks before HOD)');
                    }

                    // 2. Final inspection not booked 1 week before HOD
                    if (daysUntilHod <= 7 && !inspections?.has_final_booked) {
                        atRiskReasons.push('Final inspection not booked (due 1 week before HOD)');
                    }

                    // 3. QA test report not available 45 days before HOD
                    if (daysUntilHod <= 45 && !qa?.has_passed_qa) {
                        atRiskReasons.push('QA test report not available (due 45 days before HOD)');
                    }
                }

                return {
                    ...shipment,
                    po: po || undefined,
                    atRiskStatus: atRiskReasons.length > 0,
                    atRiskReasons
                };
            });
            // Note: Client/vendor/office filters are already applied in the SQL query, no need to re-filter here

            // Also include unshipped POs from OS340 that have upcoming HOD dates (for at-risk tracking)
            // Only include POs that haven't shipped yet and have a HOD date within 60 days
            const shippedPoNumbers = new Set(os650Shipments.map(s => s.poNumber));
            const sixtyDaysFromNow = new Date();
            sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60);

            // Build conditions for pending POs query
            const pendingConditions = [
                sql`ph.status NOT IN ('Closed', 'Cancelled', 'Shipped')`,
                sql`ph.shipment_status IS NULL`,
                sql`ph.revised_ship_date IS NOT NULL`,
                sql`ph.revised_ship_date <= ${sixtyDaysFromNow.toISOString()}`,
                sql`COALESCE(ph.total_value, 0) > 0`
            ];
            // Apply same client filter to pending POs
            if (filters?.client) {
                pendingConditions.push(sql`ph.client = (SELECT c.name FROM clients c WHERE c.code = ${filters.client})`);
            }
            if (filters?.vendor) {
                pendingConditions.push(sql`(
              ph.vendor = ${filters.vendor}
              OR UPPER(TRIM(ph.vendor)) = UPPER(TRIM(${filters.vendor}))
            )`);
            }
            if (filters?.office) {
                pendingConditions.push(sql`ph.office = ${filters.office}`);
            }

            const pendingWhereClause = sql`WHERE ${sql.join(pendingConditions, sql` AND `)}`;

            const unshippedPOs = await db.execute<{
                id: number;
                po_number: string;
                vendor: string | null;
                office: string | null;
                client: string | null;
                status: string | null;
                revised_ship_date: string | null;
                revised_cancel_date: string | null;
                original_ship_date: string | null;
                total_value: number | null;
                total_quantity: number | null;
                sku: string | null;
            }>(sql`
            SELECT DISTINCT ON (ph.po_number)
              ph.id, ph.po_number, ph.vendor, ph.office, ph.client, ph.status,
              ph.revised_ship_date::text, ph.revised_cancel_date::text, ph.original_ship_date::text,
              ph.total_value, ph.total_quantity, pli.sku
            FROM po_headers ph
            LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
            ${pendingWhereClause}
            ORDER BY ph.po_number, ph.revised_ship_date
          `);

            // Filter out POs that already have OS650 shipments
            const filteredPendingPOs = unshippedPOs.rows.filter(po => !shippedPoNumbers.has(po.po_number));

            // Get inspection and QA data for pending POs
            const pendingPoNumbers = filteredPendingPOs.map(p => p.po_number);
            const pendingInspectionMap = new Map<string, { has_inline_booked: boolean; has_final_booked: boolean }>();
            const pendingQaMap = new Map<string, { has_passed_qa: boolean }>();

            if (pendingPoNumbers.length > 0) {
                const pendingInspectionData = await db.execute<{
                    po_number: string;
                    inspection_type: string;
                }>(sql`
              SELECT DISTINCT po_number, inspection_type
              FROM inspections
              WHERE po_number IN (${sql.join(pendingPoNumbers.map(p => sql`${p}`), sql`, `)})
            `);

                for (const row of pendingInspectionData.rows) {
                    if (!pendingInspectionMap.has(row.po_number)) {
                        pendingInspectionMap.set(row.po_number, { has_inline_booked: false, has_final_booked: false });
                    }
                    const entry = pendingInspectionMap.get(row.po_number)!;
                    if (row.inspection_type?.toLowerCase().includes('inline')) {
                        entry.has_inline_booked = true;
                    }
                    if (row.inspection_type?.toLowerCase().includes('final')) {
                        entry.has_final_booked = true;
                    }
                }

                const pendingQaData = await db.execute<{
                    po_number: string;
                    has_passed: boolean;
                }>(sql`
              SELECT DISTINCT 
                ph.po_number,
                EXISTS(
                  SELECT 1 FROM quality_tests qt 
                  JOIN skus s ON qt.sku_id = s.id 
                  WHERE s.sku = pli.sku AND qt.result = 'Pass'
                ) as has_passed
              FROM po_headers ph
              LEFT JOIN po_line_items pli ON pli.po_header_id = ph.id
              WHERE ph.po_number IN (${sql.join(pendingPoNumbers.map(p => sql`${p}`), sql`, `)})
            `);

                for (const row of pendingQaData.rows) {
                    pendingQaMap.set(row.po_number, { has_passed_qa: row.has_passed });
                }
            }

            // Convert pending POs to shipment-like format with at-risk calculation
            const now = new Date();
            const pendingShipments = filteredPendingPOs.map((po, index) => {
                const inspections = pendingInspectionMap.get(po.po_number);
                const qa = pendingQaMap.get(po.po_number);
                const hod = po.revised_ship_date ? new Date(po.revised_ship_date) : null;

                const atRiskReasons: string[] = [];

                if (hod && hod > now) {
                    const daysUntilHod = Math.ceil((hod.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                    // 1. Inline inspection not booked 2 weeks before HOD
                    if (daysUntilHod <= 14 && !inspections?.has_inline_booked) {
                        atRiskReasons.push('Inline inspection not booked (due 2 weeks before HOD)');
                    }

                    // 2. Final inspection not booked 1 week before HOD
                    if (daysUntilHod <= 7 && !inspections?.has_final_booked) {
                        atRiskReasons.push('Final inspection not booked (due 1 week before HOD)');
                    }

                    // 3. QA test report not available 45 days before HOD
                    if (daysUntilHod <= 45 && !qa?.has_passed_qa) {
                        atRiskReasons.push('QA test report not available (due 45 days before HOD)');
                    }
                } else if (hod && hod <= now) {
                    // Past HOD date - mark as overdue
                    atRiskReasons.push('Past HOD date - overdue');
                }

                return {
                    id: po.id + 1000000, // Offset ID to avoid collision with OS650 IDs
                    poId: po.id,
                    poNumber: po.po_number,
                    shipmentNumber: index + 1,
                    deliveryToConsolidator: null,
                    qtyShipped: null,
                    shippedValue: null,
                    actualPortOfLoading: null,
                    actualSailingDate: null,
                    eta: null,
                    actualShipMode: null,
                    poe: null,
                    vesselFlight: null,
                    cargoReadyDate: po.original_ship_date ? new Date(po.original_ship_date) : null,
                    loadType: null,
                    ptsNumber: null,
                    logisticStatus: null,
                    lateReasonCode: null,
                    hodStatus: null, // Not shipped yet
                    soFirstSubmissionDate: null,
                    ptsStatus: null,
                    cargoReceiptStatus: null,
                    reason: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lineItemId: null,
                    style: null,
                    po: {
                        id: po.id,
                        poNumber: po.po_number,
                        vendor: po.vendor,
                        office: po.office,
                        client: po.client,
                        status: po.status,
                        revisedShipDate: po.revised_ship_date ? new Date(po.revised_ship_date) : null,
                        revisedCancelDate: po.revised_cancel_date ? new Date(po.revised_cancel_date) : null,
                        totalValue: po.total_value,
                        orderQuantity: po.total_quantity,
                    } as any,
                    atRiskStatus: atRiskReasons.length > 0,
                    atRiskReasons
                };
            });

            // Combine shipped and pending shipments, respecting the limit
            const combined = [...enrichedShipments, ...pendingShipments];
            return combined.slice(0, limit);
        }

        // Fall back to generating shipment records from po_headers (OS340 data)
        // This fallback only generates "shipped" POs, so if includeShipped is false, return empty
        if (!filters?.includeShipped) {
            // When includeShipped is false, the fallback path should return no shipped records
            // The fallback only generates shipped POs, so return empty array
            return [];
        }

        // Get shipped POs (those with shipment_status of 'On-Time' or 'Late' or with ship dates)
        const fallbackConditions: SQL<unknown>[] = [];

        // Only include POs that have shipped (have a shipment status or ship dates)
        fallbackConditions.push(
            or(
                inArray(poHeaders.shipmentStatus, ['On-Time', 'Late']),
                isNotNull(poHeaders.revisedShipDate),
                isNotNull(poHeaders.originalShipDate)
            )!
        );

        // Apply filters
        if (filters?.vendor) {
            fallbackConditions.push(eq(poHeaders.vendor, filters.vendor));
        }
        if (filters?.office) {
            fallbackConditions.push(eq(poHeaders.office, filters.office));
        }
        if (filters?.client) {
            fallbackConditions.push(eq(poHeaders.client, filters.client));
        }
        if (filters?.startDate) {
            fallbackConditions.push(gte(poHeaders.poDate, filters.startDate));
        }
        if (filters?.endDate) {
            fallbackConditions.push(lte(poHeaders.poDate, filters.endDate));
        }

        // Query unique POs with shipment data
        const poQuery = await db.selectDistinctOn([poHeaders.poNumber], {
            id: poHeaders.id,
            poNumber: poHeaders.poNumber,
            vendor: poHeaders.vendor,
            office: poHeaders.office,
            client: poHeaders.client,
            shipmentStatus: poHeaders.shipmentStatus,
            originalShipDate: poHeaders.originalShipDate,
            revisedShipDate: poHeaders.revisedShipDate,
            originalCancelDate: poHeaders.originalCancelDate,
            revisedCancelDate: poHeaders.revisedCancelDate,
            totalValue: poHeaders.totalValue,
            orderQuantity: poHeaders.totalQuantity,
            scheduleShipMode: poHeaders.scheduleShipMode,
            schedulePoe: poHeaders.schedulePoe,
            createdAt: poHeaders.createdAt,
        })
            .from(poHeaders)
            .where(and(...fallbackConditions))
            .orderBy(poHeaders.poNumber, desc(poHeaders.createdAt));

        // Convert PO data to shipment-like format
        const virtualShipments: (Shipment & { po?: PurchaseOrder })[] = poQuery.map((po, index) => {
            // Determine HOD status based on shipment_status
            let hodStatus: string | null = null;
            if (po.shipmentStatus === 'On-Time') {
                hodStatus = 'On-Time';
            } else if (po.shipmentStatus === 'Late') {
                hodStatus = 'Late';
            }

            return {
                id: po.id, // Use PO id as virtual shipment id
                poId: po.id,
                poNumber: po.poNumber,
                shipmentNumber: index + 1,
                deliveryToConsolidator: po.revisedShipDate || po.originalShipDate,
                qtyShipped: po.orderQuantity,
                shippedValue: po.totalValue,
                actualPortOfLoading: po.schedulePoe || null,
                actualSailingDate: po.revisedShipDate || po.originalShipDate,
                eta: po.revisedCancelDate || po.originalCancelDate,
                actualShipMode: po.scheduleShipMode || null,
                poe: po.schedulePoe || null,
                vesselFlight: null,
                createdAt: po.createdAt,
                updatedAt: po.createdAt,
                lineItemId: null,
                style: null,
                cargoReadyDate: po.originalShipDate,
                loadType: null,
                ptsNumber: null,
                logisticStatus: po.shipmentStatus === 'On-Time' ? 'Delivered' : (po.shipmentStatus === 'Late' ? 'Delayed' : 'In Transit'),
                lateReasonCode: null,
                hodStatus: hodStatus,
                soFirstSubmissionDate: null,
                ptsStatus: null,
                cargoReceiptStatus: null,
                reason: null,
                // Include full PO data
                po: {
                    id: po.id,
                    poNumber: po.poNumber,
                    copNumber: null,
                    client: po.client,
                    clientDivision: null,
                    clientDepartment: null,
                    buyer: null,
                    vendor: po.vendor,
                    factory: null,
                    productGroup: null,
                    productCategory: null,
                    season: null,
                    sku: null,
                    style: null,
                    sellerStyle: null,
                    newSku: null,
                    newStyle: null,
                    bigBets: null,
                    cbxItem: null,
                    orderClassification: null,
                    programDescription: null,
                    program: null,
                    merchandiseProgram: null,
                    office: po.office,
                    mrSection: null,
                    poDate: null,
                    month: null,
                    originalShipDate: po.originalShipDate,
                    originalCancelDate: po.originalCancelDate,
                    revisedShipDate: po.revisedShipDate,
                    revisedCancelDate: po.revisedCancelDate,
                    revisedBy: null,
                    revisedReason: null,
                    orderQuantity: po.orderQuantity,
                    balanceQuantity: null,
                    unitPrice: null,
                    totalValue: po.totalValue,
                    scheduleShipMode: po.scheduleShipMode,
                    schedulePoe: po.schedulePoe,
                    status: null,
                    shipmentStatus: po.shipmentStatus,
                    createdAt: po.createdAt,
                    updatedAt: null,
                    createdBy: null,
                    updatedBy: null,
                } as unknown as PurchaseOrder,
            };
        });

        return virtualShipments;
    }

    async getShipmentDetail(id: number): Promise<{ shipment: Shipment | null; po: PurchaseOrder | null; allShipments: Shipment[] }> {
        const shipmentResult = await db.select().from(shipments).where(eq(shipments.id, id));
        const shipment = shipmentResult[0] || null;

        if (!shipment) {
            return { shipment: null, po: null, allShipments: [] };
        }

        // Get the PO
        const po = shipment.poNumber ? await this.getPurchaseOrderByNumber(shipment.poNumber) : null;

        // Get all shipments for this PO
        const allShipments = shipment.poNumber
            ? await db.select().from(shipments).where(eq(shipments.poNumber, shipment.poNumber)).orderBy(shipments.shipmentNumber)
            : [];

        return { shipment, po: po || null, allShipments };
    }


    async getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | undefined> {
        const result = await db.select().from(poHeaders).where(eq(poHeaders.poNumber, poNumber));
        if (!result[0]) return undefined;
        const header = result[0];
        return {
            ...header,
            sku: null,
            style: null,
            sellerStyle: null,
            newSku: null,
            newStyle: null,
            bigBets: null,
            cbxItem: null,
            orderQuantity: header.totalQuantity,
            unitPrice: 0,
            createdBy: null,
            updatedBy: null,
        } as PurchaseOrder;
    }

    async getPurchaseOrdersByNumbers(poNumbers: string[]): Promise<Map<string, PurchaseOrder>> {
        if (poNumbers.length === 0) {
            return new Map();
        }
        const result = await db.select().from(poHeaders).where(inArray(poHeaders.poNumber, poNumbers));
        const poMap = new Map<string, PurchaseOrder>();
        for (const header of result) {
            if (!poMap.has(header.poNumber)) {
                poMap.set(header.poNumber, {
                    ...header,
                    sku: null,
                    style: null,
                    sellerStyle: null,
                    newSku: null,
                    newStyle: null,
                    bigBets: null,
                    cbxItem: null,
                    orderQuantity: header.totalQuantity,
                    unitPrice: 0,
                    createdBy: null,
                    updatedBy: null,
                } as PurchaseOrder);
            }
        }
        return poMap;
    }

}