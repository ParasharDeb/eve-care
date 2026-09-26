import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

export interface UserRequest extends Request {
  user?: {
    id: string;
  };
}

export const userAuthMiddleware = (
  req: UserRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.log.warn("user auth middleware: missing or invalid authorization header");
    return res.status(401).json({
      message: "Authorization header missing or invalid",
    });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET!
    ) as { userId: string };

    req.user = {
      id: decoded.userId,
    };
    next();
  } catch (error) {
    req.log.warn({ reason: "invalid_or_expired_jwt" }, "user auth middleware failed");
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};
