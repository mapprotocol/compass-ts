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
    startBlock: string;
    mcs: string;
    blockConfirmations: string;
    butterEntrance: string;
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
}

export function parseConfig(path:string): Config {
    if (!fs.existsSync(path)) {

    }

    let err:Error;
    //读取文件内容，并转化为Json对象
    let ret:Config = JSON.parse(fs.readFileSync(path, "utf8"));
    return ret;
}
