import { User, InsertUser, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { IUserService } from "../Abstractions/IUserService";

export class UserService implements IUserService {
    async getUser(id: string): Promise<User | undefined> {
        const result = await db.select().from(users).where(eq(users.id, id));
        return result[0];
    }

    async getUserByEmail(email: string): Promise<User | undefined> {
        const result = await db.select().from(users).where(eq(users.email, email));
        return result[0];
    }

    async createUser(user: InsertUser): Promise<User> {
        const result = await db.insert(users).values(user as any).returning();
        return result[0];
    }
}
