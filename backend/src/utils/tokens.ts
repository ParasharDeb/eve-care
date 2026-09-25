import jwt from "jsonwebtoken"
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