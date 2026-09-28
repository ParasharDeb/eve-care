// Postgres aborts one of two transactions that deadlock or conflict on the same rows
// (e.g. the webhook confirming a booking while the user cancels it). Prisma reports that as P2034.
// The aborted transaction was fully rolled back, so it's safe to simply run it again.
export async function retryOnConflict<T>(fn:()=>Promise<T>,maxAttempts=3):Promise<T>{
    for(let attempt=1; ; attempt++){
        try {
            return await fn()
        } catch (error) {
            const isConflict=(error as { code?: string }).code==="P2034"
            if(!isConflict || attempt>=maxAttempts){
                throw error
            }
        }
    }
}
