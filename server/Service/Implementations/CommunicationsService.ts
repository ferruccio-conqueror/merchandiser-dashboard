import { Communication, InsertCommunication, communications } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../../db";
import { ICommunicationsService } from "../Abstractions/ICommunicationsService";

export class CommunicationsService implements ICommunicationsService {

    async getCommunicationsByEntity(entityType: string, entityId: number): Promise<Communication[]> {
        return db
            .select()
            .from(communications)
            .where(
                and(
                    eq(communications.entityType, entityType),
                    eq(communications.entityId, entityId)
                )
            )
            .orderBy(desc(communications.communicationDate));
    }

    async getCommunicationsByPoNumber(poNumber: string): Promise<Communication[]> {
        return db
            .select()
            .from(communications)
            .where(eq(communications.poNumber, poNumber))
            .orderBy(desc(communications.communicationDate));
    }

    async createCommunication(communication: InsertCommunication): Promise<Communication> {
        const result = await db
            .insert(communications)
            .values(communication as any)
            .returning();
        
        return result[0];
    }

    async updateCommunication(id: number, communication: Partial<InsertCommunication>): Promise<Communication | undefined> {
        const result = await db
            .update(communications)
            .set({ ...communication, updatedAt: new Date() })
            .where(eq(communications.id, id))
            .returning();
        
        return result[0];
    }

    async deleteCommunication(id: number): Promise<boolean> {
        const result = await db
            .delete(communications)
            .where(eq(communications.id, id))
            .returning();
        
        return result.length > 0;
    }
}