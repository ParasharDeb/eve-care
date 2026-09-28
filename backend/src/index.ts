import "dotenv/config"
import { app } from "./app"
import { logger } from "./utils/logger"
import { checkEnv } from "./utils/env"

const problems=checkEnv()
if(problems.length>0){
    logger.fatal({ problems },"invalid environment, see backend/.env.example")
    process.exit(1)
}

const PORT = Number(process.env.PORT ?? 8080)
app.listen(PORT,()=>logger.info({ port:PORT },"server started"))
