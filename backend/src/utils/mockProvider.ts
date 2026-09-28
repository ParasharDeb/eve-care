import { createHmac, randomUUID } from "crypto"
import { logger } from "./logger"

export type WebhookEvent={
    eventId:string
    providerRef:string
    status:"SUCCESS"|"FAILED"
    failureReason?:string
}

// how long the fake gateway "takes" to process a payment before reporting the result
const PROCESSING_DELAY_MS=1500

export function signWebhook(body:string|Buffer,secret:string){
    return createHmac("sha256",secret).update(body).digest("hex")
}

// 5xx, 404 and 429 can succeed later (server down, payment not visible yet, rate limited).
// any other 4xx means the event itself is wrong, so sending it again won't help
function isRetryable(status:number){
    return status>=500 || status===404 || status===429
}

// Sends one event to the webhook, retrying with exponential backoff (1s, 2s, 4s, 8s by default).
// Every attempt sends the exact same body, same eventId, so if an attempt was actually processed
// but its response got lost, the webhook sees a duplicate and ignores it.
export async function deliverWebhook(
    url:string,
    event:WebhookEvent,
    secret:string,
    options={ maxAttempts:5, baseDelayMs:1000 }
):Promise<{ delivered:boolean, attempts:number }>{
    const body=JSON.stringify(event)
    const signature=signWebhook(body,secret)

    for(let attempt=1; attempt<=options.maxAttempts; attempt++){
        try {
            const res=await fetch(url,{
                method:"POST",
                headers:{ "Content-Type":"application/json", "X-Webhook-Signature":signature },
                body
            })
            if(res.ok){
                logger.info({ eventId:event.eventId, attempt },"mock provider: webhook delivered")
                return { delivered:true, attempts:attempt }
            }
            logger.warn({ eventId:event.eventId, attempt, status:res.status },"mock provider: webhook rejected")
            if(!isRetryable(res.status)){
                return { delivered:false, attempts:attempt }
            }
        } catch (error) {
            // network error: our server is down or restarting
            logger.warn({ err:error, eventId:event.eventId, attempt },"mock provider: webhook delivery failed")
        }
        if(attempt<options.maxAttempts){
            await new Promise(resolve=>setTimeout(resolve,options.baseDelayMs*2**(attempt-1)))
        }
    }
    // the payment stays Created; a real system would alert here or reconcile later
    logger.error({ eventId:event.eventId, attempts:options.maxAttempts },"mock provider: gave up delivering webhook")
    return { delivered:false, attempts:options.maxAttempts }
}

// Plays the payment gateway: a moment after a payment starts, it decides the outcome and
// reports it to our own webhook, the same way razorpay/stripe would.
export function processPayment(providerRef:string,simulate?:"success"|"failure"){
    if(process.env.MOCK_PROVIDER_ENABLED==="false"){
        return
    }
    const secret=process.env.WEBHOOK_SECRET
    if(!secret){
        logger.error({ providerRef },"mock provider: WEBHOOK_SECRET is not set, payment will stay Created")
        return
    }
    const succeeded=simulate ? simulate==="success" : Math.random()<0.8
    const event:WebhookEvent={
        eventId:`evt_${randomUUID()}`,
        providerRef,
        status:succeeded?"SUCCESS":"FAILED",
        ...(succeeded ? {} : { failureReason:"card_declined" })
    }
    const url=process.env.WEBHOOK_URL ?? `http://localhost:${process.env.PORT ?? 8080}/payments/webhook`

    setTimeout(()=>{
        void deliverWebhook(url,event,secret)
    },PROCESSING_DELAY_MS)
}
