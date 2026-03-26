export interface Log {
    ChainId: string,
    EventId: number,
    ProjectId: number,
    TxHash: string,
    ContractAddres: string,
    Topic: string,
    BlockNumber: string | number,
    BlockHash:string,
    TxIndex: number,
    LogIndex: number,
    LogData: string,
    TxTimestamp: number,
}

export interface Storage {
    GetEvent():void;
} 