import type { User } from "../../drizzle/schema";
import type { Request } from "express";

export type AuthenticatedUser = User & {
  taskUid?: string;
  isCron?: boolean;
};

class SDKServer {
  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const now = new Date();
    return {
      id: 1,
      openId: "local_admin",
      name: "Local Admin",
      email: "admin@localhost",
      loginMethod: "local",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    };
  }
}

export const sdk = new SDKServer();

