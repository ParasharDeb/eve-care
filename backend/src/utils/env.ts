// everything the app reads with process.env.X! — checked once at startup so a missing
// secret stops the server right away instead of turning the first signin into a 500
const required=[
    "DATABASE_URL",
    "ACCESS_TOKEN_SECRET",
    "HOSPITAL_TOKEN_SECRET",
    "REFRESH_TOKEN_SECRET",
    "HOSPITAL_REFRESH_TOKEN_SECRET",
    "USER_REFRESH_COOKIE",
    "REFRESH_COOKIE",
    "WEBHOOK_SECRET"
] as const

// if two of these are the same, one kind of token would verify as the other
const mustDiffer=[
    ["ACCESS_TOKEN_SECRET","HOSPITAL_TOKEN_SECRET"],
    ["REFRESH_TOKEN_SECRET","HOSPITAL_REFRESH_TOKEN_SECRET"],
    ["USER_REFRESH_COOKIE","REFRESH_COOKIE"]
] as const

// returns what's wrong, empty when the env is fine
export function checkEnv(env=process.env){
    const problems:string[]=[]
    for(const name of required){
        if(!env[name]?.trim()){
            problems.push(`${name} is not set`)
        }
    }
    for(const [a,b] of mustDiffer){
        if(env[a] && env[a]===env[b]){
            problems.push(`${a} and ${b} must be different`)
        }
    }
    return problems
}
