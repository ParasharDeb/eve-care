import pino from "pino"
import { pinoHttp } from "pino-http"
import { randomUUID } from "crypto"

const isProduction = process.env.NODE_ENV === "production"

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  ...(isProduction ? {} : { transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss" } } }),
})

export const httpLogger = pinoHttp({
  logger,
  // route-level req.log calls only carry reqId instead of the whole request
  quietReqLogger: true,
  genReqId: (req, res) => {
    const id = (req.headers["x-request-id"] as string) ?? randomUUID()
    res.setHeader("x-request-id", id)
    return id
  },
  // headers are omitted entirely so cookies and auth tokens never reach the logs
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error"
    if (res.statusCode >= 400) return "warn"
    return "info"
  },
})
