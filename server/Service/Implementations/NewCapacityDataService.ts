import { poHeaders, poLineItems, activeProjections } from "@shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { INewCapacityDataService } from "../Abstractions/INewCapacityDataService";

export class NewCapacityDataService implements INewCapacityDataService {

    async getOrdersOnHandFromOS340(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }> {
        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59);

        // Get all PO headers for the year with unshipped balance
        const posWithBalance = await db
            .select({
                vendor: poHeaders.vendor,
                client: poHeaders.client,
                balanceQuantity: poHeaders.balanceQuantity,
                totalValue: poHeaders.totalValue,
                shippedValue: poHeaders.shippedValue,
                originalShipDate: poHeaders.originalShipDate,
            })
            .from(poHeaders)
            .where(
                and(
                    sql`${poHeaders.poDate} >= ${startOfYear}`,
                    sql`${poHeaders.poDate} <= ${endOfYear}`,
                    sql`${poHeaders.balanceQuantity} > 0` // Only unshipped orders
                )
            );

        const byVendor: Record<string, number> = {};
        const byVendorBrandMonth: Record<string, Record<string, Record<number, number>>> = {};

        for (let i = 0; i < posWithBalance.length; i++) {
            const po = posWithBalance[i] as any;
            const vendor = po.vendor || 'Unknown';
            const brand = po.client || 'Unknown';
            
            // Calculate unshipped value
            const unshippedValue = (po.totalValue || 0) - (po.shippedValue || 0);

            // Aggregate by vendor
            if (!byVendor[vendor]) {
                byVendor[vendor] = 0;
            }
            byVendor[vendor] += unshippedValue;

            // Aggregate by vendor, brand, and month
            if (po.originalShipDate) {
                const month = new Date(po.originalShipDate).getMonth() + 1; // 1-12

                if (!byVendorBrandMonth[vendor]) {
                    byVendorBrandMonth[vendor] = {};
                }
                if (!byVendorBrandMonth[vendor][brand]) {
                    byVendorBrandMonth[vendor][brand] = {};
                }
                if (!byVendorBrandMonth[vendor][brand][month]) {
                    byVendorBrandMonth[vendor][brand][month] = 0;
                }
                byVendorBrandMonth[vendor][brand][month] += unshippedValue;
            }
        }

        return { byVendor, byVendorBrandMonth };
    }

    async getAllOrdersFromOS340(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
        shippedByVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }> {
        const startOfYear = new Date(year, 0, 1);
        const endOfYear = new Date(year, 11, 31, 23, 59, 59);

        // Get all PO headers for the year
        const allPos = await db
            .select({
                vendor: poHeaders.vendor,
                client: poHeaders.client,
                totalValue: poHeaders.totalValue,
                shippedValue: poHeaders.shippedValue,
                originalShipDate: poHeaders.originalShipDate,
            })
            .from(poHeaders)
            .where(
                and(
                    sql`${poHeaders.poDate} >= ${startOfYear}`,
                    sql`${poHeaders.poDate} <= ${endOfYear}`
                )
            );

        const byVendor: Record<string, number> = {};
        const byVendorBrandMonth: Record<string, Record<string, Record<number, number>>> = {};
        const shippedByVendorBrandMonth: Record<string, Record<string, Record<number, number>>> = {};

        for (let i = 0; i < allPos.length; i++) {
            const po = allPos[i] as any;
            const vendor = po.vendor || 'Unknown';
            const brand = po.client || 'Unknown';
            const totalValue = po.totalValue || 0;
            const shippedValue = po.shippedValue || 0;

            // Aggregate total by vendor
            if (!byVendor[vendor]) {
                byVendor[vendor] = 0;
            }
            byVendor[vendor] += totalValue;

            // Aggregate by vendor, brand, and month
            if (po.originalShipDate) {
                const month = new Date(po.originalShipDate).getMonth() + 1; // 1-12

                // Total orders
                if (!byVendorBrandMonth[vendor]) {
                    byVendorBrandMonth[vendor] = {};
                }
                if (!byVendorBrandMonth[vendor][brand]) {
                    byVendorBrandMonth[vendor][brand] = {};
                }
                if (!byVendorBrandMonth[vendor][brand][month]) {
                    byVendorBrandMonth[vendor][brand][month] = 0;
                }
                byVendorBrandMonth[vendor][brand][month] += totalValue;

                // Shipped orders
                if (!shippedByVendorBrandMonth[vendor]) {
                    shippedByVendorBrandMonth[vendor] = {};
                }
                if (!shippedByVendorBrandMonth[vendor][brand]) {
                    shippedByVendorBrandMonth[vendor][brand] = {};
                }
                if (!shippedByVendorBrandMonth[vendor][brand][month]) {
                    shippedByVendorBrandMonth[vendor][brand][month] = 0;
                }
                shippedByVendorBrandMonth[vendor][brand][month] += shippedValue;
            }
        }

        return { byVendor, byVendorBrandMonth, shippedByVendorBrandMonth };
    }

    async getProjectionsFromSkuProjections(year: number): Promise<{
        byVendor: Record<string, number>;
        byVendorBrandMonth: Record<string, Record<string, Record<number, number>>>;
    }> {
        // Get all active projections for the year
        const projections = await db
            .select({
                vendorCode: activeProjections.vendorCode,
                brand: activeProjections.brand,
                year: activeProjections.year,
                month: activeProjections.month,
                projectionValue: activeProjections.projectionValue,
            })
            .from(activeProjections)
            .where(eq(activeProjections.year, year));

        const byVendor: Record<string, number> = {};
        const byVendorBrandMonth: Record<string, Record<string, Record<number, number>>> = {};

        for (let i = 0; i < projections.length; i++) {
            const proj = projections[i] as any;
            const vendor = proj.vendorCode || 'Unknown';
            const brand = proj.brand || 'Unknown';
            const month = proj.month; // 1-12
            const value = Number(proj.projectionValue) || 0;

            // Aggregate by vendor
            if (!byVendor[vendor]) {
                byVendor[vendor] = 0;
            }
            byVendor[vendor] += value;

            // Aggregate by vendor, brand, and month
            if (!byVendorBrandMonth[vendor]) {
                byVendorBrandMonth[vendor] = {};
            }
            if (!byVendorBrandMonth[vendor][brand]) {
                byVendorBrandMonth[vendor][brand] = {};
            }
            if (!byVendorBrandMonth[vendor][brand][month]) {
                byVendorBrandMonth[vendor][brand][month] = 0;
            }
            byVendorBrandMonth[vendor][brand][month] += value;
        }

        return { byVendor, byVendorBrandMonth };
    }
}