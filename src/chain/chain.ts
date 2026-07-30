import { Config } from '../config/config'
import { SolChain } from './sol/sync'

interface IChain {
    getName:()=>string,
    sync:()=>void,
}

export function initChain(cfg:Config): IChain[] {
    let ret:IChain[] = [];
    const butterApiKey = process.env.BACKEND_API_KEY || process.env.BUTTER_API_KEY || cfg.other.butterApiKey || "";
    for (let index = 0; index < cfg.chains.length; index++) {
        switch (cfg.chains[index].type) {
        case "solana":
            var sol = new SolChain(cfg.chains[index], cfg.other.butter, butterApiKey)
            // ret[index] = sol
            ret.push(sol)
            break
        default:
            console.log("Not support this type", cfg.chains[index].type)
        }
        
    }
    return ret;
}
