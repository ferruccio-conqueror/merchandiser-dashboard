import { ActiveProjection, activeProjections, poHeaders, vendorCapacityAliases, vendors } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import { IProjectionMatchingAndValidationService } from "../Abstractions/IProjectionMatchingAndValidation";

export class ProjectionMatchingAndValidationService implements IProjectionMatchingAndValidationService {


    // Match projections to incoming POs by SKU and target month
    // Regular projections: match by vendorCode + sku + year + month
    // SPO/MTO projections: match by vendorCode + collection + year + month to POs with "MTO {collection}" in program_description
    async matchProjectionsToPOs(importedPOs: Array<{ poNumber: string; vendor: string | null; sku: string | null; orderQuantity: number; totalValue: number; poDate: Date | null; originalShipDate: Date | null; programDescription?: string | null }>): Promise<{ matched: number; variances: number; errors: string[] }> {
        const errors: string[] = [];
        let matchedCount = 0;
        let varianceCount = 0;

        // Get all unmatched projections
        const unmatchedProjections = await db.select()
            .from(activeProjections)
            .where(eq(activeProjections.matchStatus, 'unmatched'));

        if (unmatchedProjections.length === 0) {
            return { matched: 0, variances: 0, errors: [] };
        }

        // Build vendor name/alias to vendor ID mapping for resolving PO vendor names
        const allVendors = await db.select().from(vendors);
        const allAliases = await db.select().from(vendorCapacityAliases);

        const vendorNameToId = new Map<string, number>();
        for (const v of allVendors) {
            if (v.name) {
                vendorNameToId.set(v.name.toLowerCase().trim(), v.id);
            }
        }
        for (const alias of allAliases) {
            if (alias.aliasName) {
                vendorNameToId.set(alias.aliasName.toLowerCase().trim(), alias.vendorId);
            }
        }

        // Build lookup maps for regular and SPO projections using VENDOR ID (not code)
        // Regular: vendorId_sku_year_month -> projection
        const regularProjectionMap = new Map<string, typeof unmatchedProjections[0]>();
        // SPO/MTO: vendorId_collection_year_month -> projection (uses collection field)
        const spoProjectionMap = new Map<string, typeof unmatchedProjections[0]>();

        for (const proj of unmatchedProjections) {
            if (proj.orderType === 'mto' && proj.collection) {
                // SPO projection - match by collection and vendor ID
                const key = `${proj.vendorId}_${proj.collection.toLowerCase()}_${proj.year}_${proj.month}`;
                spoProjectionMap.set(key, proj);
            } else if (proj.sku) {
                // Regular projection - match by SKU and vendor ID (skip if no SKU)
                const key = `${proj.vendorId}_${proj.sku.toLowerCase()}_${proj.year}_${proj.month}`;
                regularProjectionMap.set(key, proj);
            }
        }

        // Helper to update projection with match data
        const updateProjectionMatch = async (
            projection: typeof unmatchedProjections[0],
            po: typeof importedPOs[0],
            lookupKey: string,
            projectionMap: Map<string, typeof unmatchedProjections[0]>
        ) => {
            try {
                const projectedQty = projection.quantity || 0;
                const projectedValue = projection.projectionValue || 0;
                const actualQty = po.orderQuantity || 0;
                const actualValue = po.totalValue || 0;

                const qtyVariance = actualQty - projectedQty;
                const valueVariance = actualValue - projectedValue;
                const variancePctValue = projectedQty > 0
                    ? Math.round(((actualQty - projectedQty) / projectedQty) * 100)
                    : 0;

                await db.update(activeProjections)
                    .set({
                        matchStatus: 'matched',
                        matchedPoNumber: po.poNumber,
                        matchedAt: new Date(),
                        actualQuantity: actualQty,
                        actualValue: actualValue,
                        quantityVariance: qtyVariance,
                        valueVariance: valueVariance,
                        variancePct: variancePctValue,
                        updatedAt: new Date()
                    })
                    .where(eq(activeProjections.id, projection.id));

                matchedCount++;

                if (Math.abs(variancePctValue) > 10) {
                    varianceCount++;
                }

                projectionMap.delete(lookupKey);
                return true;
            } catch (err: any) {
                errors.push(`Failed to match PO ${po.poNumber} to projection: ${err.message}`);
                return false;
            }
        };

        // Extract collection name from program_description if it contains MTO pattern
        // Patterns: "MTO COLLECTION", "MTO:COLLECTION", "MTO - COLLECTION", "MTO HOXTON FEB 2026"
        // Known SPO collections: AMBROISE, FORTE, HOXTON, PM SYMMETRIC, VERA, AVIATOR, LOWE, EMILE, LAURA/TIFF, BLUME, SOMA, EDENDALE
        const knownCollections = [
            'ambroise', 'forte', 'hoxton', 'pm symmetric', 'vera', 'aviator',
            'lowe', 'emile', 'laura/tiff', 'laura', 'tiff', 'blume', 'soma', 'edendale'
        ];

        const extractMtoCollection = (programDesc: string | null | undefined): string | null => {
            if (!programDesc) return null;
            const lowerDesc = programDesc.toLowerCase();

            // Must contain "mto" to be considered an MTO PO
            if (!lowerDesc.includes('mto')) return null;

            // Try to match known collections first (most reliable)
            for (const collection of knownCollections) {
                if (lowerDesc.includes(collection)) {
                    return collection;
                }
            }

            // Fallback: Extract first word(s) after MTO, stopping at months, years, or common delimiters
            // Patterns like "MTO HOXTON FEB 2026" should extract "HOXTON"
            const monthsPattern = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i;
            const yearPattern = /\b(20\d{2})\b/;

            // Extract text after MTO
            const mtoMatch = lowerDesc.match(/mto[\s:_-]+([a-z\s\/]+)/i);
            if (mtoMatch && mtoMatch[1]) {
                let extracted = mtoMatch[1].trim();

                // Stop at month names
                const monthMatch = extracted.match(monthsPattern);
                if (monthMatch && monthMatch.index !== undefined && monthMatch.index > 0) {
                    extracted = extracted.substring(0, monthMatch.index).trim();
                }

                // Stop at year numbers (2020-2029)
                const yearMatch = extracted.match(yearPattern);
                if (yearMatch && yearMatch.index !== undefined && yearMatch.index > 0) {
                    extracted = extracted.substring(0, yearMatch.index).trim();
                }

                // Clean up trailing whitespace and common suffixes
                extracted = extracted.replace(/[\s,]+$/, '').trim();

                if (extracted.length > 0) {
                    return extracted;
                }
            }

            return null;
        };

        // Process each imported PO
        for (const po of importedPOs) {
            if (!po.vendor || !po.originalShipDate) continue;

            const targetYear = po.originalShipDate.getFullYear();
            const targetMonth = po.originalShipDate.getMonth() + 1; // 1-12

            // Resolve vendor name to vendor ID using our vendor/alias mapping
            const vendorId = vendorNameToId.get(po.vendor.toLowerCase().trim());
            if (!vendorId) {
                // Vendor not found in our database - skip this PO for projection matching
                continue;
            }

            // Try SPO/MTO matching first if program_description contains MTO pattern
            const mtoCollection = extractMtoCollection(po.programDescription);
            if (mtoCollection) {
                const spoKey = `${vendorId}_${mtoCollection}_${targetYear}_${targetMonth}`;
                const spoProjection = spoProjectionMap.get(spoKey);

                if (spoProjection) {
                    await updateProjectionMatch(spoProjection, po, spoKey, spoProjectionMap);
                    continue; // Move to next PO
                }
            }

            // Try regular SKU matching
            if (po.sku) {
                const skuKey = po.sku.toLowerCase().trim();
                const lookupKey = `${vendorId}_${skuKey}_${targetYear}_${targetMonth}`;
                const matchedProjection = regularProjectionMap.get(lookupKey);

                if (matchedProjection) {
                    await updateProjectionMatch(matchedProjection, po, lookupKey, regularProjectionMap);
                }
            }
        }

        return { matched: matchedCount, variances: varianceCount, errors };
    }

    // Get overdue/at-risk projections (within threshold days without matching PO)
    async getOverdueProjections(thresholdDays: number = 90, filters?: { vendor?: string; brand?: string; year?: number; month?: number }): Promise<Array<ActiveProjection & { daysUntilDue: number; isOverdue: boolean }>> {
        const today = new Date();

        // Build filter conditions
        const conditions: any[] = [
            eq(activeProjections.matchStatus, 'unmatched')
        ];

        if (filters?.vendorId) {
            conditions.push(eq(activeProjections.vendorId, filters.vendorId));
        }
        if (filters?.brand) {
            conditions.push(eq(activeProjections.brand, filters.brand));
        }
        if (filters?.year) {
            conditions.push(eq(activeProjections.year, filters.year));
        }
        if (filters?.month) {
            conditions.push(eq(activeProjections.month, filters.month));
        }

        // Get all unmatched projections with filters
        const unmatched = await db.select()
            .from(activeProjections)
            .where(and(...conditions));

        const overdueProjections: Array<ActiveProjection & { daysUntilDue: number; isOverdue: boolean }> = [];

        for (const proj of unmatched) {
            // Skip MTO projections - they go to the SPO tab
            if (proj.orderType === 'mto') continue;

            // Calculate target date from year/month
            const targetDate = new Date(proj.year, proj.month - 1, 1); // First day of target month
            const daysUntil = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            // Determine threshold based on order type (regular = 90 days)
            const effectiveThreshold = thresholdDays;

            // Include if within threshold or overdue
            if (daysUntil <= effectiveThreshold) {
                overdueProjections.push({
                    ...proj,
                    daysUntilDue: daysUntil,
                    isOverdue: daysUntil < 0
                });
            }
        }

        // Sort by most urgent first (lowest daysUntilDue)
        overdueProjections.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

        return overdueProjections;
    }

    // Get projections with significant volume variances
    async getProjectionsWithVariance(minVariancePct: number = 10, filters?: { vendor?: string; brand?: string; year?: number; month?: number }): Promise<ActiveProjection[]> {
        // Build filter conditions
        const conditions: any[] = [
            eq(activeProjections.matchStatus, 'matched'),
            or(
                gt(activeProjections.variancePct, minVariancePct),
                sql`${activeProjections.variancePct} < ${-minVariancePct}`
            )
        ];

        if (filters?.vendorId) {
            conditions.push(eq(activeProjections.vendorId, filters.vendorId));
        }
        if (filters?.brand) {
            conditions.push(eq(activeProjections.brand, filters.brand));
        }
        if (filters?.year) {
            conditions.push(eq(activeProjections.year, filters.year));
        }
        if (filters?.month) {
            conditions.push(eq(activeProjections.month, filters.month));
        }

        // Get matched projections with variance above threshold (excluding MTO which goes to SPO tab)
        const result = await db.select()
            .from(activeProjections)
            .where(and(
                ...conditions,
                or(
                    isNull(activeProjections.orderType),
                    sql`${activeProjections.orderType} != 'mto'`
                )
            ))
            .orderBy(desc(sql`ABS(${activeProjections.variancePct})`));

        return result;
    }

    // Get SPO/MTO projections
    async getSpoProjections(filters?: { vendor?: string; brand?: string; year?: number; month?: number }): Promise<Array<ActiveProjection & { daysUntilDue?: number; isOverdue?: boolean }>> {
        const today = new Date();

        // Build filter conditions - only MTO order type
        const conditions: any[] = [
            eq(activeProjections.orderType, 'mto')
        ];

        if (filters?.vendorId) {
            conditions.push(eq(activeProjections.vendorId, filters.vendorId));
        }
        if (filters?.brand) {
            conditions.push(eq(activeProjections.brand, filters.brand));
        }
        if (filters?.year) {
            conditions.push(eq(activeProjections.year, filters.year));
        }
        if (filters?.month) {
            conditions.push(eq(activeProjections.month, filters.month));
        }

        const spoProjections = await db.select()
            .from(activeProjections)
            .where(and(...conditions))
            .orderBy(desc(activeProjections.year), desc(activeProjections.month));

        // Add days until due for unmatched projections
        return spoProjections.map(proj => {
            if (proj.matchStatus === 'unmatched') {
                const targetDate = new Date(proj.year, proj.month - 1, 1);
                const daysUntil = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                return {
                    ...proj,
                    daysUntilDue: daysUntil,
                    isOverdue: daysUntil < 0
                };
            }
            return proj;
        });
    }

    // Get filter options for projections page
    async getProjectionFilterOptions(): Promise<{ vendors: Array<{ id: number; name: string; vendorCode: string }>; brands: string[] }> {
        // Get unique vendors from projections joined with vendors table for proper names
        const vendorResults = await db.selectDistinct({
            vendorId: activeProjections.vendorId,
            vendorCode: activeProjections.vendorCode,
            vendorName: vendors.name
        })
            .from(activeProjections)
            .leftJoin(vendors, eq(activeProjections.vendorId, vendors.id))
            .orderBy(vendors.name);

        // Get unique brands
        const brandResults = await db.selectDistinct({ brand: activeProjections.brand })
            .from(activeProjections)
            .orderBy(activeProjections.brand);

        // Filter out 'CBH' - it's the client/parent company, not a brand
        // Actual brands are: CB, CB2, C&K
        // Also normalize 'CK' to 'C&K' if present
        const filteredBrands = [...new Set(
            brandResults
                .map(r => r.brand)
                .filter((b): b is string => b != null && b.trim() !== '' && b.toUpperCase() !== 'CBH')
                .map(b => b === 'CK' ? 'C&K' : b)
        )].sort();

        return {
            vendors: vendorResults
                .filter(r => r.vendorId)
                .map(r => ({
                    id: r.vendorId!,
                    name: r.vendorName || r.vendorCode || `Vendor ID ${r.vendorId}`,
                    vendorCode: r.vendorCode || ''
                })),
            brands: filteredBrands
        };
    }

    // Mark projection as expired
    async markProjectionRemoved(projectionId: number, reason: string): Promise<ActiveProjection | undefined> {
        const result = await db.update(activeProjections)
            .set({
                matchStatus: 'expired',
                comment: reason,
                commentedAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(activeProjections.id, projectionId))
            .returning();

        return result[0];
    }

    // Unmatch a projection (revert to unmatched state)
    async unmatchProjection(projectionId: number): Promise<ActiveProjection | undefined> {
        const result = await db.update(activeProjections)
            .set({
                matchStatus: 'unmatched',
                matchedPoNumber: null,
                matchedAt: null,
                actualQuantity: null,
                actualValue: null,
                quantityVariance: null,
                valueVariance: null,
                variancePct: null,
                updatedAt: new Date()
            })
            .where(eq(activeProjections.id, projectionId))
            .returning();

        return result[0];
    }

    // Manually match a projection to a PO
    async manualMatchProjection(projectionId: number, poNumber: string): Promise<ActiveProjection | undefined> {
        // Get the PO details
        const po = await db.select().from(poHeaders)
            .where(eq(poHeaders.poNumber, poNumber));

        if (po.length === 0) {
            throw new Error(`PO ${poNumber} not found`);
        }

        const poData = po[0];

        // Get the projection
        const projection = await db.select().from(activeProjections)
            .where(eq(activeProjections.id, projectionId));

        if (projection.length === 0) {
            throw new Error(`Projection ${projectionId} not found`);
        }

        const proj = projection[0];

        // Calculate variances
        const actualQty = poData.totalQuantity || 0;
        const actualValue = poData.totalValue || 0;
        const qtyVariance = actualQty - (proj.quantity || 0);
        const valueVariance = actualValue - (proj.projectionValue || 0);
        const variancePctValue = (proj.quantity || 0) > 0
            ? Math.round((qtyVariance / (proj.quantity || 1)) * 100)
            : 0;

        const result = await db.update(activeProjections)
            .set({
                matchStatus: 'matched',
                matchedPoNumber: poNumber,
                matchedAt: new Date(),
                actualQuantity: actualQty,
                actualValue: actualValue,
                quantityVariance: qtyVariance,
                valueVariance: valueVariance,
                variancePct: variancePctValue,
                updatedAt: new Date()
            })
            .where(eq(activeProjections.id, projectionId))
            .returning();

        return result[0];
    }

    // Update projection order type (regular/mto)
    async updateProjectionOrderType(projectionId: number, orderType: 'regular' | 'mto'): Promise<ActiveProjection | undefined> {
        const result = await db.update(activeProjections)
            .set({
                orderType,
                updatedAt: new Date()
            })
            .where(eq(activeProjections.id, projectionId))
            .returning();

        return result[0];
    }

    // Get projection validation summary for a vendor
    async getProjectionValidationSummary(vendorId?: number, filters?: { vendor?: string; brand?: string; year?: number; month?: number }): Promise<{
        totalProjections: number;
        unmatched: number;
        matched: number;
        removed: number;
        overdueCount: number;
        atRiskCount: number;
        withVariance: number;
        spoTotal: number;
        spoMatched: number;
        spoUnmatched: number;
    }> {
        const conditions: any[] = [];
        if (vendorId) {
            conditions.push(eq(activeProjections.vendorId, vendorId));
        }
        // if (filters?.vendor) {
        //     conditions.push(eq(activeProjections.vendorId, filters.vendor));
        // }
        if (filters?.brand) {
            conditions.push(eq(activeProjections.brand, filters.brand));
        }
        if (filters?.year) {
            conditions.push(eq(activeProjections.year, filters.year));
        }
        if (filters?.month) {
            conditions.push(eq(activeProjections.month, filters.month));
        }

        const projections = await db.select().from(activeProjections)
            .where(conditions.length > 0 ? and(...conditions) : undefined);

        const today = new Date();
        let overdueCount = 0;
        let atRiskCount = 0;
        let withVariance = 0;
        let spoTotal = 0;
        let spoMatched = 0;
        let spoUnmatched = 0;

        for (const proj of projections) {
            // Count SPO/MTO items
            if (proj.orderType === 'mto') {
                spoTotal++;
                if (proj.matchStatus === 'matched') spoMatched++;
                if (proj.matchStatus === 'unmatched') spoUnmatched++;
            }

            // Count regular overdue/at-risk (excluding MTO which has separate tracking)
            if (proj.matchStatus === 'unmatched' && proj.orderType !== 'mto') {
                const targetDate = new Date(proj.year, proj.month - 1, 1);
                const daysUntil = Math.floor((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                const threshold = 90;

                if (daysUntil < 0) overdueCount++;
                else if (daysUntil <= threshold) atRiskCount++;
            }

            // Count variances (excluding MTO which has separate tracking)
            if (proj.matchStatus === 'matched' && proj.variancePct && Math.abs(proj.variancePct) > 10 && proj.orderType !== 'mto') {
                withVariance++;
            }
        }

        return {
            totalProjections: projections.length,
            unmatched: projections.filter(p => p.matchStatus === 'unmatched').length,
            matched: projections.filter(p => p.matchStatus === 'matched').length,
            removed: projections.filter(p => p.matchStatus === 'expired').length,
            overdueCount,
            atRiskCount,
            withVariance,
            spoTotal,
            spoMatched,
            spoUnmatched
        };
    }

}