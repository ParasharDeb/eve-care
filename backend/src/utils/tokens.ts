import jwt from "jsonwebtoken"
import { createHash } from "crypto"
export interface JwtPayload {
  userId: string;
}
export function generateAccessToken(userId: string) {
  return jwt.sign(
    { userId },
    process.env.ACCESS_TOKEN_SECRET!,
    {
      expiresIn: "15m",
    }
  );
}

export function generateRefreshToken(userId: string) {
  return jwt.sign(
    { userId },
    process.env.REFRESH_TOKEN_SECRET!,
    {
      expiresIn: "30d",
    }
  );
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
