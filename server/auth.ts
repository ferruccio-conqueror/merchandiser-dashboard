import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { staff } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { FULL_ACCESS_ROLES, LIMITED_ACCESS_ROLES } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    staffId: number;
    staffName: string;
    staffRole: string;
    staffEmail: string | null;
  }
}

declare global {
  namespace Express {
    interface Request {
      staffUser?: {
        id: number;
        name: string;
        role: string;
        email: string | null;
      };
    }
  }
}

export function getSession(): RequestHandler {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  // Development auto-login bypass - automatically log in as admin
  if (process.env.NODE_ENV === "development") {
    app.use(async (req: Request, _res: Response, next: NextFunction) => {
      // Skip if already authenticated or if it's a login/logout request
      if (req.session.staffId || req.path === "/api/auth/logout") {
        return next();
      }
      
      // Auto-login as admin user (John Pemberton, id 19)
      const [adminUser] = await db
        .select()
        .from(staff)
        .where(and(eq(staff.id, 19), eq(staff.status, "active")));
      
      if (adminUser) {
        req.session.staffId = adminUser.id;
        req.session.staffName = adminUser.name;
        req.session.staffRole = adminUser.role;
        req.session.staffEmail = adminUser.email;
      }
      
      next();
    });
  }

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const [staffMember] = await db
        .select()
        .from(staff)
        .where(and(eq(staff.email, email), eq(staff.status, "active")));

      if (!staffMember) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      if (!staffMember.passwordHash) {
        return res.status(401).json({ 
          message: "Password not set. Please set up your password first.",
          needsPasswordSetup: true,
          staffId: staffMember.id
        });
      }

      const isValid = await bcrypt.compare(password, staffMember.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      await db
        .update(staff)
        .set({ lastLoginAt: new Date() })
        .where(eq(staff.id, staffMember.id));

      req.session.staffId = staffMember.id;
      req.session.staffName = staffMember.name;
      req.session.staffRole = staffMember.role;
      req.session.staffEmail = staffMember.email;

      res.json({
        id: staffMember.id,
        name: staffMember.name,
        role: staffMember.role,
        email: staffMember.email,
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/setup-password", async (req: Request, res: Response) => {
    try {
      const { email, password, confirmPassword } = req.body;

      if (!email || !password || !confirmPassword) {
        return res.status(400).json({ message: "All fields are required" });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({ message: "Passwords do not match" });
      }

      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const [staffMember] = await db
        .select()
        .from(staff)
        .where(and(eq(staff.email, email), eq(staff.status, "active")));

      if (!staffMember) {
        return res.status(404).json({ message: "Staff member not found with this email" });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      await db
        .update(staff)
        .set({ 
          passwordHash,
          passwordSetAt: new Date(),
          lastLoginAt: new Date()
        })
        .where(eq(staff.id, staffMember.id));

      req.session.staffId = staffMember.id;
      req.session.staffName = staffMember.name;
      req.session.staffRole = staffMember.role;
      req.session.staffEmail = staffMember.email;

      res.json({
        id: staffMember.id,
        name: staffMember.name,
        role: staffMember.role,
        email: staffMember.email,
        message: "Password set successfully"
      });
    } catch (error: any) {
      console.error("Setup password error:", error);
      res.status(500).json({ message: "Failed to set password" });
    }
  });

  app.post("/api/auth/change-password", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;
      const staffId = req.session.staffId;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ message: "All fields are required" });
      }

      if (newPassword !== confirmPassword) {
        return res.status(400).json({ message: "New passwords do not match" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const [staffMember] = await db
        .select()
        .from(staff)
        .where(eq(staff.id, staffId!));

      if (!staffMember || !staffMember.passwordHash) {
        return res.status(401).json({ message: "Invalid session" });
      }

      const isValid = await bcrypt.compare(currentPassword, staffMember.passwordHash);
      if (!isValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);

      await db
        .update(staff)
        .set({ passwordHash, passwordSetAt: new Date() })
        .where(eq(staff.id, staffId!));

      res.json({ message: "Password changed successfully" });
    } catch (error: any) {
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.session.staffId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const [staffMember] = await db
      .select({
        id: staff.id,
        name: staff.name,
        role: staff.role,
        email: staff.email,
      })
      .from(staff)
      .where(eq(staff.id, req.session.staffId));

    if (!staffMember) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "User not found" });
    }

    res.json(staffMember);
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/staff-list", async (req: Request, res: Response) => {
    try {
      const staffList = await db
        .select({
          id: staff.id,
          name: staff.name,
          email: staff.email,
          role: staff.role,
          hasPassword: staff.passwordHash,
        })
        .from(staff)
        .where(eq(staff.status, "active"));

      res.json(staffList.map(s => ({
        ...s,
        hasPassword: !!s.hasPassword
      })));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch staff list" });
    }
  });
}

export const isAuthenticated: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.staffId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  req.staffUser = {
    id: req.session.staffId,
    name: req.session.staffName!,
    role: req.session.staffRole!,
    email: req.session.staffEmail ?? null,
  };

  next();
};

export const requireFullAccess: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.staffId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const role = req.session.staffRole;
  if (!role || !FULL_ACCESS_ROLES.includes(role as any)) {
    return res.status(403).json({ message: "Access denied. Full access required." });
  }

  req.staffUser = {
    id: req.session.staffId,
    name: req.session.staffName!,
    role: req.session.staffRole!,
    email: req.session.staffEmail ?? null,
  };

  next();
};

export function hasFullAccess(role: string): boolean {
  return FULL_ACCESS_ROLES.includes(role as any);
}

export function hasLimitedAccess(role: string): boolean {
  return LIMITED_ACCESS_ROLES.includes(role as any);
}

export interface RoleBasedFilter {
  type: 'merchandiser' | 'merchandisingManager' | null;
  value: string | null;
}

export function getMerchandiserFilter(req: Request): string | null {
  if (!req.session.staffId || !req.session.staffRole) {
    return null;
  }
  
  // Only merchandisers get filtered by their own name
  if (req.session.staffRole === 'merchandiser' || req.session.staffRole === 'senior_merchandiser') {
    return req.session.staffName || null;
  }
  
  return null;
}

export function getManagerFilter(req: Request): string | null {
  if (!req.session.staffId || !req.session.staffRole) {
    return null;
  }
  
  // Merchandising managers see their team via merchandisingManager filter
  if (req.session.staffRole === 'merchandising_manager') {
    return req.session.staffName || null;
  }
  
  return null;
}

export function getRoleBasedFilters(req: Request): RoleBasedFilter {
  if (!req.session.staffId || !req.session.staffRole) {
    return { type: null, value: null };
  }
  
  // Merchandisers see only their own data
  if (req.session.staffRole === 'merchandiser' || req.session.staffRole === 'senior_merchandiser') {
    return { type: 'merchandiser', value: req.session.staffName || null };
  }
  
  // Merchandising managers see their team's data
  if (req.session.staffRole === 'merchandising_manager') {
    return { type: 'merchandisingManager', value: req.session.staffName || null };
  }
  
  // Full access roles see everything
  return { type: null, value: null };
}

export function getMerchandiserFilterFromUser(user: { name: string; role: string } | undefined): string | null {
  if (!user) {
    return null;
  }
  
  // Only merchandisers get filtered by their own name
  if (user.role === 'merchandiser' || user.role === 'senior_merchandiser') {
    return user.name;
  }
  
  return null;
}

export async function canViewStaffKPIs(
  requesterId: number,
  requesterRole: string,
  targetStaffId: number,
  storage: { getStaffById: (id: number) => Promise<any> }
): Promise<boolean> {
  // Admins and General Merchandising Managers can see everyone
  if (hasFullAccess(requesterRole)) {
    return true;
  }
  
  // Users can always see their own KPIs
  if (requesterId === targetStaffId) {
    return true;
  }
  
  // Managers can see KPIs of their direct reports
  if (requesterRole === 'merchandising_manager') {
    const targetStaff = await storage.getStaffById(targetStaffId);
    if (targetStaff && targetStaff.managerId === requesterId) {
      return true;
    }
  }
  
  return false;
}
