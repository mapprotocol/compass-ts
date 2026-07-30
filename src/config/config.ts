import * as fs from 'fs';

export interface Config {  
   chains:Chain[];
   other: Other;
   storages: Storage[];
}

export interface Chain {
    name: string;
    type: string;
    id: string;
    endpoint: string;
    opts: ChainOpt;
}

export interface ChainOpt {
    startBlock: string | Record<string, string>;
    mcs: string | string[];
    blockConfirmations: string;
    butterEntrance: string;
    supportedBridgeMints?: string[];
    nativeTokenOutAddress?: string;
}


interface Storage {
    url: string;
    type: string;
    host: string;
    port: number,
    user: string;
    psw: string;
    db: string;
}

interface Other {
    monitorUrl: string;
    env:string;
    butter:string;
    butterApiKey?: string;
}

export function parseConfig(path:string): Config {
    if (!fs.existsSync(path)) {
        throw new Error(`Config file not found: ${path}`);
    }

    return JSON.parse(fs.readFileSync(path, "utf8")) as Config;
}
