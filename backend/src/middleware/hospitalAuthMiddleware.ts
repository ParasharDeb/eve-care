import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

export interface HospitalRequest extends Request {
  hospital?: {
    id: string;
  };
}

export const hospitalAuthMiddleware = (
  req: HospitalRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.log.warn("hospital auth middleware: missing or invalid authorization header");
    return res.status(401).json({
      message: "Authorization header missing or invalid",
    });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(
      token,
      process.env.HOSPITAL_TOKEN_SECRET!
    ) as { userId: string };

    req.hospital = {
      id: decoded.userId,
    };
    next();
  } catch (error) {
    req.log.warn({ reason: "invalid_or_expired_jwt" }, "hospital auth middleware failed");
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};
