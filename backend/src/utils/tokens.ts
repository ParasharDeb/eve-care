import jwt from "jsonwebtoken"
import { createHash, randomUUID } from "crypto"
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

export function generateHospitalAccessToken(hospitalId: string) {
  return jwt.sign(
    { userId: hospitalId },
    process.env.HOSPITAL_TOKEN_SECRET!,
    {
      expiresIn: "15m",
    }
  );
}

// jwtid makes every refresh token unique. without it, two refreshes in the same second
// sign the exact same token and rotation does nothing
export function generateRefreshToken(userId: string) {
  return jwt.sign(
    { userId },
    process.env.REFRESH_TOKEN_SECRET!,
    {
      expiresIn: "30d",
      jwtid: randomUUID(),
    }
  );
}

// own secret, so a user's refresh token can never even verify on the hospital routes
export function generateHospitalRefreshToken(hospitalId: string) {
  return jwt.sign(
    { userId: hospitalId },
    process.env.HOSPITAL_REFRESH_TOKEN_SECRET!,
    {
      expiresIn: "30d",
      jwtid: randomUUID(),
    }
  );
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
