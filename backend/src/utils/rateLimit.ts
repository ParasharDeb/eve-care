import { rateLimit } from "express-rate-limit"

// counted per client IP. RATE_LIMIT_DISABLED is read on every request so the
// test suite can switch limits off, and the rate limit tests can switch them back on
function limiter(windowMs:number,limit:number,message:string){
    return rateLimit({
        windowMs,
        limit,
        standardHeaders:"draft-8",
        legacyHeaders:false,
        skip:()=>process.env.RATE_LIMIT_DISABLED==="true",
        handler:(req,res)=>{
            req.log.warn({ path:req.originalUrl },"rate limit exceeded")
            res.status(429).json({
                message
            })
        }
    })
}

// every /api route: stops one client from flooding the server
export const apiLimiter=limiter(60*1000,100,"too many requests, slow down")

// signin and signup: slows down password guessing and account spam
export const authLimiter=limiter(15*60*1000,10,"too many attempts, try again in 15 minutes")

// starting payments and reading them back
export const paymentLimiter=limiter(60*1000,20,"too many payment requests, try again in a minute")
