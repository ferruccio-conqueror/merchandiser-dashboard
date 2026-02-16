import { User, InsertUser } from "@shared/schema";

export interface IUserService {
    // User operations
    getUser(id: string): Promise<User | undefined>;
    getUserByEmail(email: string): Promise<User | undefined>;
    createUser(user: InsertUser): Promise<User>;
}